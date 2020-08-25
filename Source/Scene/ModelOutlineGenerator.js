import ForEach from "../ThirdParty/GltfPipeline/ForEach.js";
import WebGLConstants from "../Core/WebGLConstants.js";
import defined from "../Core/defined.js";
import Cartesian3 from "../Core/Cartesian3.js";

function ModelOutlineGenerator() {}

ModelOutlineGenerator.generateOutlinesForModel = function (model) {
  var gltf = model.gltf;
  ForEach.mesh(gltf, function (mesh, meshId) {
    ForEach.meshPrimitive(mesh, function (_primitive, primitiveId) {
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
  if (!defined(normalAccessorGltf.bufferView)) {
    normalAccessorGltf.bufferView = 0;
  }
  var normalBufferViewGltf = bufferViews[normalAccessorGltf.bufferView];

  if (!defined(normalBufferViewGltf.byteStride)) {
    normalBufferViewGltf.byteStride = 12;
  }
  if (!defined(positionBufferViewGltf.byteStride)) {
    positionBufferViewGltf.byteStride = 12;
  }

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

  var halfEdgeMap = new Map();
  var vertexPositionGetter = generateVertexAttributeGetter(
    positions,
    positionBufferViewGltf.byteStride / 4
  );

  for (let i = 0; i < triangleIndexAccessorGltf.count; i += 3) {
    addIndexedTriangleToEdgeGraph(
      halfEdgeMap,
      i,
      triangleIndices,
      vertexPositionGetter
    );
  }

  var normalBufferView = loadResources.getBuffer(normalBufferViewGltf);
  var normals = new Float32Array(
    normalBufferView.buffer,
    normalBufferView.byteOffset + normalAccessorGltf.byteOffset,
    normalAccessorGltf.count * (normalBufferViewGltf.byteStride / 4)
  );
  var vertexNormalGetter = generateVertexAttributeGetter(
    normals,
    normalBufferViewGltf.byteStride / 4
  );
  var minimumAngle = Math.PI / 20;

  if (
    defined(mesh.primitives[primitiveId].extensions) &&
    defined(mesh.primitives[primitiveId].extensions.CESIUM_primitive_outline) &&
    defined(
      mesh.primitives[primitiveId].extensions.CESIUM_primitive_outline
        .outlineWhenAngleBetweenFaceNormalsExceeds
    )
  ) {
    minimumAngle =
      mesh.primitives[primitiveId].extensions.CESIUM_primitive_outline
        .outlineWhenAngleBetweenFaceNormalsExceeds;
  }

  var outlineIndexBuffer = findEdgesToOutline(
    halfEdgeMap,
    vertexNormalGetter,
    triangleIndices,
    minimumAngle
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
  var bufferViewId =
    bufferViews.push({
      buffer: bufferId,
      byteOffset: 0,
      byteLength: outlineIndexBuffer.byteLength,
      target: WebGLConstants.ELEMENT_ARRAY_BUFFER,
    }) - 1;

  // Add new accessor
  var accessorId =
    accessors.push({
      bufferView: bufferViewId,
      byteOffset: 0,
      componentType: WebGLConstants.UNSIGNED_INT,
      count: outlineIndexBuffer.length, // start and end for each line
    }) - 1;

  mesh.primitives[primitiveId].extensions = {
    CESIUM_primitive_outline: {
      indices: accessorId,
    },
  };
  gltf.extensionsUsed.push("CESIUM_primitive_outline");
}

function generateVertexAttributeGetter(vertexArray, elementsPerVertex) {
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
  triangleStartIndex,
  triangleIndices,
  vertexPositionGetter
) {
  var vertexIndexA = triangleIndices[triangleStartIndex];
  var vertexIndexB = triangleIndices[triangleStartIndex + 1];
  var vertexIndexC = triangleIndices[triangleStartIndex + 2];
  var first = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    vertexIndexA,
    vertexIndexB,
    triangleStartIndex
  );
  var second = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    vertexIndexB,
    vertexIndexC,
    triangleStartIndex
  );
  var last = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    vertexIndexC,
    vertexIndexA,
    triangleStartIndex
  );

  // and the other direction...
  var first2 = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    vertexIndexC,
    vertexIndexB,
    triangleStartIndex
  );
  var second2 = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    vertexIndexB,
    vertexIndexA,
    triangleStartIndex
  );
  var last2 = addHalfEdge(
    halfEdgeMap,
    vertexPositionGetter,
    vertexIndexA,
    vertexIndexC,
    triangleStartIndex
  );
}

function addHalfEdge(
  halfEdgeMap,
  vertexPositionGetter,
  sourceVertexIdx,
  destinationVertexIdx,
  triangleIndex
) {
  var halfEdge = {
    sourceVertex: vertexPositionGetter(sourceVertexIdx),
    destinationVertex: vertexPositionGetter(destinationVertexIdx),
    originalIdx: [sourceVertexIdx],
    destinationIdx: [destinationVertexIdx],
  };
  if (defined(triangleIndex)) {
    halfEdge.triangleStartIndex = [triangleIndex];
  }
  var mapIdx = generateMapKey(
    halfEdge.sourceVertex,
    halfEdge.destinationVertex
  );
  var halfEdgeFromMap = halfEdgeMap.get(mapIdx);
  if (halfEdgeFromMap) {
    halfEdgeFromMap.originalIdx.push(sourceVertexIdx);
    halfEdgeFromMap.destinationIdx.push(destinationVertexIdx);
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
    "#" +
    destinationVertex[0] +
    destinationVertex[1] +
    destinationVertex[2]
  );
}

function getNeighboringEdge(halfEdgeMap, edge) {
  var neighborIdx = generateMapKey(edge.destinationVertex, edge.sourceVertex);
  var neighbor = halfEdgeMap.get(neighborIdx);
  var tolerance = Number.EPSILON;
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

// Returns index of first vertex of triangle
function getFirstVertexOfFaces(halfEdge, triangleIndices) {
  var faces = [];
  if (halfEdge.triangleStartIndex) {
    for (var index of halfEdge.triangleStartIndex) {
      faces.push(triangleIndices[index]);
    }
  } else {
    for (var index of halfEdge.originalIdx) {
      var triangleStart = index - (index % 3);
      faces.push(triangleStart);
    }
  }
  return faces;
}

function findEdgesToOutline(
  halfEdgeMap,
  vertexNormalGetter,
  triangleIndices,
  minimumAngle
) {
  var outlineThese = [];
  var checked = new Set();
  var allEdges = Array.from(halfEdgeMap.values());
  for (var i = 0; i < allEdges.length; i++) {
    var edge = allEdges[i];
    if (
      checked.has(generateMapKey(edge.sourceVertex, edge.destinationVertex)) ||
      checked.has(generateMapKey(edge.destinationVertex, edge.sourceVertex))
    ) {
      continue;
    }
    var neighbor = getNeighboringEdge(halfEdgeMap, edge);
    if (!defined(neighbor)) {
      continue;
    }
    var numIndicesToCheck = 21;
    if (edge.originalIdx.length > numIndicesToCheck) {
      edge.originalIdx = edge.originalIdx.slice(0, numIndicesToCheck);
    }
    if (neighbor.originalIdx.length > numIndicesToCheck) {
      neighbor.originalIdx = neighbor.originalIdx.slice(0, numIndicesToCheck);
    }
    // FIXME
    // there is something wrong with your face logic
    // why do you need the first vertex of every face?
    // why not just use the ones attached to the edge?
    var primaryEdgeFaces = getFirstVertexOfFaces(edge, triangleIndices);
    var neighbourEdgeFaces = getFirstVertexOfFaces(neighbor, triangleIndices);
    var highlight = false;
    var highlightStartVertex;
    var highlightEndVertex;
    for (var i = 0; i < primaryEdgeFaces.length; i++) {
      if (highlight) {
        break;
      }
      var faceNormal = vertexNormalGetter(primaryEdgeFaces[i]);
      for (var j = 0; j < neighbourEdgeFaces.length; j++) {
        if (primaryEdgeFaces[i] === neighbourEdgeFaces[j]) {
          continue;
        }
        var neighborNormal = vertexNormalGetter(neighbourEdgeFaces[j]);
        if (!defined(faceNormal) || !defined(neighborNormal)) {
          continue;
        }
        var angleBetween;
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

          // highlightStartVertex = edge.originalIdx[0];
          // let allVerticesInTriangle = [
          //   triangleIndices[edge.triangleStartIndex[i]],
          //   triangleIndices[edge.triangleStartIndex[i] + 1],
          //   triangleIndices[edge.triangleStartIndex[i] + 2],
          // ];
          // let orderInTriangle = allVerticesInTriangle.indexOf(
          //   highlightStartVertex
          // );
          // let destOrderInTriangle = (orderInTriangle + 1) % 3;
          // highlightEndVertex = allVerticesInTriangle[destOrderInTriangle];

          highlightStartVertex = edge.originalIdx[0];
          highlightEndVertex = edge.destinationIdx[0];
          outlineThese.push(highlightStartVertex);
          outlineThese.push(highlightEndVertex);
          highlight = true;
          break;
          //   highlightStartVertex = neighbor.originalIdx[0];
          //   highlightEndVertex = neighbor.destinationIdx[0];
          //   outlineThese.push(highlightStartVertex);
          //   outlineThese.push(highlightEndVertex);
        }
      }
    }
    // if (highlight) {
    //   outlineThese.push(highlightStartVertex);
    //   outlineThese.push(highlightEndVertex);
    // }
    checked.add(generateMapKey(edge.sourceVertex, edge.destinationVertex));
    checked.add(
      generateMapKey(neighbor.sourceVertex, neighbor.destinationVertex)
    );
  }
  // TODO: check how big the indices are, and if they can fit into a Uint16, use one
  return new Uint32Array(outlineThese);
}

export default ModelOutlineGenerator;
