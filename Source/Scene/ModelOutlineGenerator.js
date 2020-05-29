import ForEach from "../ThirdParty/GltfPipeline/ForEach.js";
import WebGLConstants from "../Core/WebGLConstants.js";
import defined from "../Core/defined.js";
import Cartesian3 from "../Core/Cartesian3";

function ModelOutlineGenerator() {}

ModelOutlineGenerator.generateOutlinesForModel = function (model) {
  var gltf = model.gltf;
  ForEach.mesh(gltf, function (mesh, meshId) {
    ForEach.meshPrimitive(mesh, function (primitive, primitiveId) {
      outlinePrimitive(model, meshId, primitiveId);
    });
  });
};

function outlinePrimitive(model, meshId, primitiveId) {
  // TODO: Currently only works for indexed primitives
  var gltf = model.gltf;
  var mesh = gltf.meshes[meshId];
  var primitive = mesh.primitives[primitiveId];
  var accessors = gltf.accessors;
  var bufferViews = gltf.bufferViews;
  // TODO: handle unindexed tris
  var triangleIndexAccessorGltf = accessors[primitive.indices];
  var triangleIndexBufferViewGltf =
    bufferViews[triangleIndexAccessorGltf.bufferView];
  var positionAccessorGltf = accessors[primitive.attributes.POSITION];
  var positionBufferViewGltf = bufferViews[positionAccessorGltf.bufferView];
  // TODO: Error handling for no normals
  var normalAccessorGltf = accessors[primitive.attributes.NORMAL];
  var normalBufferViewGltf = bufferViews[normalAccessorGltf.bufferView];

  var loadResources = model._loadResources;
  var triangleIndexBufferView = loadResources.getBuffer(
    triangleIndexBufferViewGltf
  );
  var positionBufferView = loadResources.getBuffer(positionBufferViewGltf);
  var positions = new Float32Array(
    positionBufferView.buffer,
    positionBufferView.byteOffset + positionAccessorGltf.byteOffset,
    positionAccessorGltf.count * 3
  );

  var triangleIndices =
    triangleIndexAccessorGltf.componentType === WebGLConstants.UNSIGNED_SHORT
      ? new Uint16Array(
          triangleIndexBufferView.buffer,
          triangleIndexBufferView.byteOffset +
            triangleIndexAccessorGltf.byteOffset,
          triangleIndexAccessorGltf.count
        )
      : new Uint32Array(
          triangleIndexBufferView.buffer,
          triangleIndexBufferView.byteOffset +
            triangleIndexAccessorGltf.byteOffset,
          triangleIndexAccessorGltf.count
        );

  var triangleGetter = generateVertexAttributeGetter(
    triangleIndices,
    triangleIndexAccessorGltf
  );

  var halfEdgeMap = new Map();
  var vertexPositionGetter = generateVertexAttributeGetter(
    positions,
    positionAccessorGltf
  );

  for (let i = 0; i < triangleIndexAccessorGltf.count; i += 1) {
    addIndexedTriangleToEdgeGraph(
      halfEdgeMap,
      i,
      triangleGetter,
      vertexPositionGetter
    );
  }
  // for (let i = 0; i < positionAccessorGltf.count; i += 3) {
  //   addTriangleToEdgeGraph(halfEdgeMap, i, vertexPositionGetter);
  // }

  var normalBufferView = loadResources.getBuffer(normalBufferViewGltf);
  var normals = new Float32Array(
    normalBufferView.buffer,
    normalBufferView.byteOffset + normalAccessorGltf.byteOffset,
    normalAccessorGltf.count * 3
  );
  var vertexNormalGetter = generateVertexAttributeGetter(
    normals,
    normalAccessorGltf
  );

  let outlineIndexBuffer = findEdgesToOutline(
    halfEdgeMap,
    vertexNormalGetter,
    triangleGetter
  );

  // Add new buffer to gltf
  var bufferId =
    gltf.buffers.push({
      byteLength: outlineIndexBuffer.byteLength,
      extras: {
        _pipeline: {
          source: outlineIndexBuffer.buffer,
        },
      },
    }) - 1;
  loadResources.buffers[bufferId] = outlineIndexBuffer;

  // Add new bufferview
  let bufferViewId =
    bufferViews.push({
      buffer: bufferId,
      byteOffset: 0,
      byteLength: outlineIndexBuffer.byteLength,
      target: WebGLConstants.ELEMENT_ARRAY_BUFFER,
    }) - 1;

  // Add new accessor
  let accessorId =
    accessors.push({
      bufferView: bufferViewId,
      byteOffset: 0,
      componentType: WebGLConstants.UNSIGNED_INT,
      count: outlineIndexBuffer.length / 2, // start and end for each line
    }) - 1;

  mesh.primitives[primitiveId]["extensions"] = {
    CESIUM_primitive_outline: {
      indices: accessorId,
    },
  };
}

function generateVertexAttributeGetter(
  vertexArray,
  accessor,
  vertexNormalGetter
) {
  var elementsPerVertex = 3;
  return function (index) {
    return [
      vertexArray[elementsPerVertex * index],
      vertexArray[elementsPerVertex * index + 1],
      vertexArray[elementsPerVertex * index + 2],
    ];
  };
}

function addIndexedTriangleToEdgeGraph(
  halfEdgeMap,
  triangleIndex,
  triangleGetter,
  vertexPositionGetter
) {
  let triangleVertexIndices = triangleGetter(triangleIndex);
  let vertexIndexA = triangleVertexIndices[0];
  let vertexIndexB = triangleVertexIndices[1];
  let vertexIndexC = triangleVertexIndices[2];
  let first = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    vertexIndexA,
    vertexIndexB,
    triangleIndex
  );
  let second = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    vertexIndexB,
    vertexIndexC,
    triangleIndex
  );
  let last = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    vertexIndexC,
    vertexIndexA,
    triangleIndex
  );
  let first2 = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    vertexIndexC,
    vertexIndexB,
    triangleIndex
  );
  let second2 = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    vertexIndexB,
    vertexIndexA,
    triangleIndex
  );
  let last2 = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    vertexIndexA,
    vertexIndexC + 2,
    triangleIndex
  );
}

function addTriangleToEdgeGraph(
  halfEdgeMap,
  triangleStartIndex,
  vertexPositionGetter
) {
  let first = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    triangleStartIndex,
    triangleStartIndex + 1,
    undefined
  );
  let second = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    triangleStartIndex + 1,
    triangleStartIndex + 2
  );
  let last = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    triangleStartIndex + 2,
    triangleStartIndex
  );
  let first2 = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    triangleStartIndex + 2,
    triangleStartIndex + 1
  );
  let second2 = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    triangleStartIndex + 1,
    triangleStartIndex
  );
  let last2 = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    triangleStartIndex,
    triangleStartIndex + 2
  );
}

function addHalfEdge(
  halfEdgeMap,
  vertexPositionGetter,
  sourceVertexIdx,
  destinationVertexIdx,
  triangleIndex
) {
  const halfEdge = {
    sourceVertex: vertexPositionGetter(sourceVertexIdx),
    destinationVertex: vertexPositionGetter(destinationVertexIdx),
    originalIdx: [sourceVertexIdx],
  };
  if (defined(triangleIndex)) {
    halfEdge.triangleStartIndex = [triangleIndex];
  }
  const mapIdx = generateMapKey(
    halfEdge.sourceVertex,
    halfEdge.destinationVertex
  );
  const halfEdgeFromMap = halfEdgeMap.get(mapIdx);
  if (halfEdgeFromMap) {
    halfEdgeFromMap.originalIdx.push(sourceVertexIdx);
    if (defined(triangleIndex)) {
      halfEdgeFromMap.triangleStartIndex.push(triangleIndex);
    }
  } else {
    halfEdgeMap.set(mapIdx, halfEdge);
  }
  return halfEdge;
}

function generateMapKey(sourceVertex, destinationVertex) {
  return (
    "" +
    sourceVertex[0] +
    sourceVertex[1] +
    sourceVertex[2] +
    destinationVertex[0] +
    destinationVertex[1] +
    destinationVertex[2]
  );
}

function getNeighboringEdge(halfEdgeMap, edge) {
  const neighborIdx = generateMapKey(edge.destinationVertex, edge.sourceVertex);
  let neighbor = halfEdgeMap.get(neighborIdx);
  const tolerance = Number.EPSILON;
  if (
    neighbor &&
    (Math.abs(neighbor.destinationVertex[0] - edge.sourceVertex[0]) >
      tolerance ||
      Math.abs(neighbor.destinationVertex[1] - edge.sourceVertex[1]) >
        tolerance ||
      Math.abs(neighbor.destinationVertex[2] - edge.sourceVertex[2]) >
        tolerance)
  ) {
    return undefined;
  }
  return neighbor;
}

function getFirstVertexOfFaces(halfEdge, triangleGetter) {
  const faces = [];
  if (halfEdge.triangleStartIndex) {
    for (let index of halfEdge.triangleStartIndex) {
      faces.push(triangleGetter(index)[0]);
    }
  } else {
    for (let index of halfEdge.originalIdx) {
      const triangleStart = index - (index % 3);
      faces.push(triangleStart);
    }
  }
  return faces;
}

function findEdgesToOutline(halfEdgeMap, vertexNormalGetter, triangleGetter) {
  var outlineThese = [];
  var minimumAngle = Math.PI / 20;
  const checked = new Set();
  const allEdges = Array.from(halfEdgeMap.values());
  for (let i = 0; i < allEdges.length; i++) {
    const edge = allEdges[i];
    if (
      checked.has(generateMapKey(edge.sourceVertex, edge.destinationVertex)) ||
      checked.has(generateMapKey(edge.destinationVertex, edge.sourceVertex))
    ) {
      continue;
    }
    const neighbor = getNeighboringEdge(halfEdgeMap, edge);
    if (!defined(neighbor)) {
      continue;
    }
    const numIndicesToCheck = 21;
    if (edge.originalIdx.length > numIndicesToCheck) {
      edge.originalIdx = edge.originalIdx.slice(0, numIndicesToCheck);
    }
    if (neighbor.originalIdx.length > numIndicesToCheck) {
      neighbor.originalIdx = neighbor.originalIdx.slice(0, numIndicesToCheck);
    }
    const primaryEdgeFaces = getFirstVertexOfFaces(edge, triangleGetter);
    const neighbourEdgeFaces = getFirstVertexOfFaces(neighbor, triangleGetter);
    let highlight = false;
    let highlightStartVertex;
    let highlightEndVertex;
    for (let i = 0; i < primaryEdgeFaces.length; i++) {
      const faceNormal = vertexNormalGetter(primaryEdgeFaces[i]);
      for (let j = 0; j < neighbourEdgeFaces.length; j++) {
        const neighborNormal = vertexNormalGetter(neighbourEdgeFaces[j]);
        if (!defined(faceNormal) || !defined(neighborNormal)) {
          continue;
        }
        let angleBetween;
        try {
          angleBetween = Cartesian3.angleBetween(
            Cartesian3.fromArray(faceNormal),
            Cartesian3.fromArray(neighborNormal)
          );
        } catch (error) {
          console.log(
            "Error trying to find the angle between two faces' normals: " +
              error
          );
          continue;
        }
        if (angleBetween > minimumAngle && angleBetween < Math.PI - 0.01) {
          highlight = true;
          // TODO: make this work for unindexed triangles
          let highlightFace = triangleGetter(edge.triangleStartIndex[i]);
          highlightStartVertex = highlightFace[0];
          highlightEndVertex = highlightFace[1];
          break;
        }
      }
    }
    if (highlight) {
      outlineThese.push(highlightStartVertex);
      outlineThese.push(highlightEndVertex);
    }
    checked.add(generateMapKey(edge.sourceVertex, edge.destinationVertex));
    checked.add(
      generateMapKey(neighbor.sourceVertex, neighbor.destinationVertex)
    );
  }
  // TODO: check how big the indices are, and if they can fit into a Uint16, use one
  return new Uint32Array(outlineThese);
}

export default ModelOutlineGenerator;
