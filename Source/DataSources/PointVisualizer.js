import AssociativeArray from "../Core/AssociativeArray.js";
import Cartesian3 from "../Core/Cartesian3.js";
import Color from "../Core/Color.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import DeveloperError from "../Core/DeveloperError.js";
import DistanceDisplayCondition from "../Core/DistanceDisplayCondition.js";
import NearFarScalar from "../Core/NearFarScalar.js";
import createBillboardPointCallback from "../Scene/createBillboardPointCallback.js";
import HeightReference from "../Scene/HeightReference.js";
import BoundingSphereState from "./BoundingSphereState.js";
import Property from "./Property.js";

var defaultColor = Color.WHITE;
var defaultOutlineColor = Color.BLACK;
var defaultOutlineWidth = 0.0;
var defaultPixelSize = 1.0;
var defaultDisableDepthTestDistance = 0.0;

var colorScratch = new Color();
var positionScratch = new Cartesian3();
var outlineColorScratch = new Color();
var scaleByDistanceScratch = new NearFarScalar();
var translucencyByDistanceScratch = new NearFarScalar();
var distanceDisplayConditionScratch = new DistanceDisplayCondition();

function EntityData(entity) {
  this.entity = entity;
  this.pointPrimitive = undefined;
  this.billboard = undefined;
  this.color = undefined;
  this.outlineColor = undefined;
  this.pixelSize = undefined;
  this.outlineWidth = undefined;
}

/**
 * A {@link Visualizer} which maps {@link Entity#point} to a {@link PointPrimitive}.
 * @alias PointVisualizer
 * @constructor
 *
 * @param {EntityCluster} entityCluster The entity cluster to manage the collection of billboards and optionally cluster with other entities.
 * @param {EntityCollection} entityCollection The entityCollection to visualize.
 */
function PointVisualizer(entityCluster, entityCollection) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(entityCluster)) {
    throw new DeveloperError("entityCluster is required.");
  }
  if (!defined(entityCollection)) {
    throw new DeveloperError("entityCollection is required.");
  }
  //>>includeEnd('debug');

  entityCollection.collectionChanged.addEventListener(
    PointVisualizer.prototype._onCollectionChanged,
    this
  );

  this._cluster = entityCluster;
  this._entityCollection = entityCollection;
  this._items = new AssociativeArray();
  this._onCollectionChanged(entityCollection, entityCollection.values, [], []);
}

/**
 * Updates the primitives created by this visualizer to match their
 * Entity counterpart at the given time.
 *
 * @param {JulianDate} time The time to update to.
 * @returns {Boolean} This function always returns true.
 */
PointVisualizer.prototype.update = function (time) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(time)) {
    throw new DeveloperError("time is required.");
  }
  //>>includeEnd('debug');

  var items = this._items.values;
  var cluster = this._cluster;
  for (var i = 0, len = items.length; i < len; i++) {
    var item = items[i];
    var entity = item.entity;
    var pointGraphics = entity._point;
    var pointPrimitive = item.pointPrimitive;
    var billboard = item.billboard;
    var heightReference = Property.getValueOrDefault(
      pointGraphics._heightReference,
      time,
      HeightReference.NONE,
      null,
      entity
    );
    var show =
      entity.isShowing &&
      entity.isAvailable(time) &&
      Property.getValueOrDefault(pointGraphics._show, time, true, null, entity);
    var position;
    if (show) {
      position = Property.getValueOrUndefined(
        entity._position,
        time,
        positionScratch,
        null,
        entity
      );
      show = defined(position);
    }
    if (!show) {
      returnPrimitive(item, entity, cluster);
      continue;
    }

    if (!Property.isConstant(entity._position)) {
      cluster._clusterDirty = true;
    }

    var needsRedraw = false;
    var updateClamping = false;
    if (heightReference !== HeightReference.NONE && !defined(billboard)) {
      if (defined(pointPrimitive)) {
        returnPrimitive(item, entity, cluster);
        pointPrimitive = undefined;
      }

      billboard = cluster.getBillboard(entity);
      billboard.id = entity;
      billboard.image = undefined;
      item.billboard = billboard;
      needsRedraw = true;

      // If this new billboard happens to have a position and height reference that match our new values,
      // billboard._updateClamping will not be called automatically. That's a problem because the clamped
      // height may be based on different terrain than is now loaded. So we'll manually call
      // _updateClamping below.
      updateClamping =
        Cartesian3.equals(billboard.position, position) &&
        billboard.heightReference === heightReference;
    } else if (
      heightReference === HeightReference.NONE &&
      !defined(pointPrimitive)
    ) {
      if (defined(billboard)) {
        returnPrimitive(item, entity, cluster);
        billboard = undefined;
      }

      pointPrimitive = cluster.getPoint(entity);
      pointPrimitive.id = entity;
      item.pointPrimitive = pointPrimitive;
    }

    if (defined(pointPrimitive)) {
      pointPrimitive.show = true;
      pointPrimitive.position = position;
      pointPrimitive.scaleByDistance = Property.getValueOrUndefined(
        pointGraphics._scaleByDistance,
        time,
        scaleByDistanceScratch,
        null,
        entity
      );
      pointPrimitive.translucencyByDistance = Property.getValueOrUndefined(
        pointGraphics._translucencyByDistance,
        time,
        translucencyByDistanceScratch,
        null,
        entity
      );
      pointPrimitive.color = Property.getValueOrDefault(
        pointGraphics._color,
        time,
        defaultColor,
        colorScratch,
        entity
      );
      pointPrimitive.outlineColor = Property.getValueOrDefault(
        pointGraphics._outlineColor,
        time,
        defaultOutlineColor,
        outlineColorScratch,
        entity
      );
      pointPrimitive.outlineWidth = Property.getValueOrDefault(
        pointGraphics._outlineWidth,
        time,
        defaultOutlineWidth,
        null,
        entity
      );
      pointPrimitive.pixelSize = Property.getValueOrDefault(
        pointGraphics._pixelSize,
        time,
        defaultPixelSize,
        null,
        entity
      );
      pointPrimitive.distanceDisplayCondition = Property.getValueOrUndefined(
        pointGraphics._distanceDisplayCondition,
        time,
        distanceDisplayConditionScratch,
        null,
        entity
      );
      pointPrimitive.disableDepthTestDistance = Property.getValueOrDefault(
        pointGraphics._disableDepthTestDistance,
        time,
        defaultDisableDepthTestDistance,
        null,
        entity
      );
    } else if (defined(billboard)) {
      billboard.show = true;
      billboard.position = position;
      billboard.scaleByDistance = Property.getValueOrUndefined(
        pointGraphics._scaleByDistance,
        time,
        scaleByDistanceScratch,
        null,
        entity
      );
      billboard.translucencyByDistance = Property.getValueOrUndefined(
        pointGraphics._translucencyByDistance,
        time,
        translucencyByDistanceScratch,
        null,
        entity
      );
      billboard.distanceDisplayCondition = Property.getValueOrUndefined(
        pointGraphics._distanceDisplayCondition,
        time,
        distanceDisplayConditionScratch,
        null,
        entity
      );
      billboard.disableDepthTestDistance = Property.getValueOrDefault(
        pointGraphics._disableDepthTestDistance,
        time,
        defaultDisableDepthTestDistance,
        null,
        entity
      );
      billboard.heightReference = heightReference;

      var newColor = Property.getValueOrDefault(
        pointGraphics._color,
        time,
        defaultColor,
        colorScratch,
        entity
      );
      var newOutlineColor = Property.getValueOrDefault(
        pointGraphics._outlineColor,
        time,
        defaultOutlineColor,
        outlineColorScratch,
        entity
      );
      var newOutlineWidth = Math.round(
        Property.getValueOrDefault(
          pointGraphics._outlineWidth,
          time,
          defaultOutlineWidth,
          null,
          entity
        )
      );
      var newPixelSize = Math.max(
        1,
        Math.round(
          Property.getValueOrDefault(
            pointGraphics._pixelSize,
            time,
            defaultPixelSize,
            null,
            entity
          )
        )
      );

      if (newOutlineWidth > 0) {
        billboard.scale = 1.0;
        needsRedraw =
          needsRedraw || //
          newOutlineWidth !== item.outlineWidth || //
          newPixelSize !== item.pixelSize || //
          !Color.equals(newColor, item.color) || //
          !Color.equals(newOutlineColor, item.outlineColor);
      } else {
        billboard.scale = newPixelSize / 50.0;
        newPixelSize = 50.0;
        needsRedraw =
          needsRedraw || //
          newOutlineWidth !== item.outlineWidth || //
          !Color.equals(newColor, item.color) || //
          !Color.equals(newOutlineColor, item.outlineColor);
      }

      if (needsRedraw) {
        item.color = Color.clone(newColor, item.color);
        item.outlineColor = Color.clone(newOutlineColor, item.outlineColor);
        item.pixelSize = newPixelSize;
        item.outlineWidth = newOutlineWidth;

        var centerAlpha = newColor.alpha;
        var cssColor = newColor.toCssColorString();
        var cssOutlineColor = newOutlineColor.toCssColorString();
        var textureId = JSON.stringify([
          cssColor,
          newPixelSize,
          cssOutlineColor,
          newOutlineWidth,
        ]);

        billboard.setImage(
          textureId,
          createBillboardPointCallback(
            centerAlpha,
            cssColor,
            cssOutlineColor,
            newOutlineWidth,
            newPixelSize
          )
        );
      }

      if (updateClamping) {
        billboard._updateClamping();
      }
    }
  }
  return true;
};

/**
 * Computes a bounding sphere which encloses the visualization produced for the specified entity.
 * The bounding sphere is in the fixed frame of the scene's globe.
 *
 * @param {Entity} entity The entity whose bounding sphere to compute.
 * @param {BoundingSphere} result The bounding sphere onto which to store the result.
 * @returns {BoundingSphereState} BoundingSphereState.DONE if the result contains the bounding sphere,
 *                       BoundingSphereState.PENDING if the result is still being computed, or
 *                       BoundingSphereState.FAILED if the entity has no visualization in the current scene.
 * @private
 */
PointVisualizer.prototype.getBoundingSphere = function (entity, result) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(entity)) {
    throw new DeveloperError("entity is required.");
  }
  if (!defined(result)) {
    throw new DeveloperError("result is required.");
  }
  //>>includeEnd('debug');

  var item = this._items.get(entity.id);
  if (
    !defined(item) ||
    !(defined(item.pointPrimitive) || defined(item.billboard))
  ) {
    return BoundingSphereState.FAILED;
  }

  if (defined(item.pointPrimitive)) {
    result.center = Cartesian3.clone(
      item.pointPrimitive.position,
      result.center
    );
  } else {
    var billboard = item.billboard;
    if (!defined(billboard._clampedPosition)) {
      return BoundingSphereState.PENDING;
    }
    result.center = Cartesian3.clone(billboard._clampedPosition, result.center);
  }

  result.radius = 0;
  return BoundingSphereState.DONE;
};

/**
 * Returns true if this object was destroyed; otherwise, false.
 *
 * @returns {Boolean} True if this object was destroyed; otherwise, false.
 */
PointVisualizer.prototype.isDestroyed = function () {
  return false;
};

/**
 * Removes and destroys all primitives created by this instance.
 */
PointVisualizer.prototype.destroy = function () {
  this._entityCollection.collectionChanged.removeEventListener(
    PointVisualizer.prototype._onCollectionChanged,
    this
  );
  var entities = this._entityCollection.values;
  for (var i = 0; i < entities.length; i++) {
    this._cluster.removePoint(entities[i]);
  }
  return destroyObject(this);
};

PointVisualizer.prototype._onCollectionChanged = function (
  entityCollection,
  added,
  removed,
  changed
) {
  var i;
  var entity;
  var items = this._items;
  var cluster = this._cluster;

  for (i = added.length - 1; i > -1; i--) {
    entity = added[i];
    if (defined(entity._point) && defined(entity._position)) {
      items.set(entity.id, new EntityData(entity));
    }
  }

  for (i = changed.length - 1; i > -1; i--) {
    entity = changed[i];
    if (defined(entity._point) && defined(entity._position)) {
      if (!items.contains(entity.id)) {
        items.set(entity.id, new EntityData(entity));
      }
    } else {
      returnPrimitive(items.get(entity.id), entity, cluster);
      items.remove(entity.id);
    }
  }

  for (i = removed.length - 1; i > -1; i--) {
    entity = removed[i];
    returnPrimitive(items.get(entity.id), entity, cluster);
    items.remove(entity.id);
  }
};

function returnPrimitive(item, entity, cluster) {
  if (defined(item)) {
    var pointPrimitive = item.pointPrimitive;
    if (defined(pointPrimitive)) {
      item.pointPrimitive = undefined;
      cluster.removePoint(entity);
      return;
    }
    var billboard = item.billboard;
    if (defined(billboard)) {
      item.billboard = undefined;
      cluster.removeBillboard(entity);
    }
  }
}
export default PointVisualizer;
