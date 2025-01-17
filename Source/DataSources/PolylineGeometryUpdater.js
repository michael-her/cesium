import ArcType from "../Core/ArcType.js";
import BoundingSphere from "../Core/BoundingSphere.js";
import Check from "../Core/Check.js";
import Color from "../Core/Color.js";
import ColorGeometryInstanceAttribute from "../Core/ColorGeometryInstanceAttribute.js";
import defaultValue from "../Core/defaultValue.js";
import defined from "../Core/defined.js";
import destroyObject from "../Core/destroyObject.js";
import DeveloperError from "../Core/DeveloperError.js";
import DistanceDisplayCondition from "../Core/DistanceDisplayCondition.js";
import DistanceDisplayConditionGeometryInstanceAttribute from "../Core/DistanceDisplayConditionGeometryInstanceAttribute.js";
import Event from "../Core/Event.js";
import GeometryInstance from "../Core/GeometryInstance.js";
import GroundPolylineGeometry from "../Core/GroundPolylineGeometry.js";
import Iso8601 from "../Core/Iso8601.js";
import oneTimeWarning from "../Core/oneTimeWarning.js";
import PolylineGeometry from "../Core/PolylineGeometry.js";
import PolylinePipeline from "../Core/PolylinePipeline.js";
import ShowGeometryInstanceAttribute from "../Core/ShowGeometryInstanceAttribute.js";
import Entity from "../DataSources/Entity.js";
import ClassificationType from "../Scene/ClassificationType.js";
import GroundPolylinePrimitive from "../Scene/GroundPolylinePrimitive.js";
import PolylineCollection from "../Scene/PolylineCollection.js";
import PolylineColorAppearance from "../Scene/PolylineColorAppearance.js";
import PolylineMaterialAppearance from "../Scene/PolylineMaterialAppearance.js";
import ShadowMode from "../Scene/ShadowMode.js";
import BoundingSphereState from "./BoundingSphereState.js";
import ColorMaterialProperty from "./ColorMaterialProperty.js";
import ConstantProperty from "./ConstantProperty.js";
import MaterialProperty from "./MaterialProperty.js";
import Property from "./Property.js";

var defaultZIndex = new ConstantProperty(0);

//We use this object to create one polyline collection per-scene.
var polylineCollections = {};

var scratchColor = new Color();
var defaultMaterial = new ColorMaterialProperty(Color.WHITE);
var defaultShow = new ConstantProperty(true);
var defaultShadows = new ConstantProperty(ShadowMode.DISABLED);
var defaultDistanceDisplayCondition = new ConstantProperty(
  new DistanceDisplayCondition()
);
var defaultClassificationType = new ConstantProperty(ClassificationType.BOTH);

function GeometryOptions() {
  this.vertexFormat = undefined;
  this.positions = undefined;
  this.width = undefined;
  this.arcType = undefined;
  this.granularity = undefined;
}

function GroundGeometryOptions() {
  this.positions = undefined;
  this.width = undefined;
  this.arcType = undefined;
  this.granularity = undefined;
}

/**
 * A {@link GeometryUpdater} for polylines.
 * Clients do not normally create this class directly, but instead rely on {@link DataSourceDisplay}.
 * @alias PolylineGeometryUpdater
 * @constructor
 *
 * @param {Entity} entity The entity containing the geometry to be visualized.
 * @param {Scene} scene The scene where visualization is taking place.
 */
function PolylineGeometryUpdater(entity, scene) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(entity)) {
    throw new DeveloperError("entity is required");
  }
  if (!defined(scene)) {
    throw new DeveloperError("scene is required");
  }
  //>>includeEnd('debug');

  this._entity = entity;
  this._scene = scene;
  this._entitySubscription = entity.definitionChanged.addEventListener(
    PolylineGeometryUpdater.prototype._onEntityPropertyChanged,
    this
  );
  this._fillEnabled = false;
  this._dynamic = false;
  this._geometryChanged = new Event();
  this._showProperty = undefined;
  this._materialProperty = undefined;
  this._shadowsProperty = undefined;
  this._distanceDisplayConditionProperty = undefined;
  this._classificationTypeProperty = undefined;
  this._depthFailMaterialProperty = undefined;
  this._geometryOptions = new GeometryOptions();
  this._groundGeometryOptions = new GroundGeometryOptions();
  this._id = "polyline-" + entity.id;
  this._clampToGround = false;
  this._supportsPolylinesOnTerrain = Entity.supportsPolylinesOnTerrain(scene);

  this._zIndex = 0;

  this._onEntityPropertyChanged(entity, "polyline", entity.polyline, undefined);
}

Object.defineProperties(PolylineGeometryUpdater.prototype, {
  /**
   * Gets the unique ID associated with this updater
   * @memberof PolylineGeometryUpdater.prototype
   * @type {String}
   * @readonly
   */
  id: {
    get: function () {
      return this._id;
    },
  },
  /**
   * Gets the entity associated with this geometry.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Entity}
   * @readonly
   */
  entity: {
    get: function () {
      return this._entity;
    },
  },
  /**
   * Gets a value indicating if the geometry has a fill component.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Boolean}
   * @readonly
   */
  fillEnabled: {
    get: function () {
      return this._fillEnabled;
    },
  },
  /**
   * Gets a value indicating if fill visibility varies with simulation time.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Boolean}
   * @readonly
   */
  hasConstantFill: {
    get: function () {
      return (
        !this._fillEnabled ||
        (!defined(this._entity.availability) &&
          Property.isConstant(this._showProperty))
      );
    },
  },
  /**
   * Gets the material property used to fill the geometry.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {MaterialProperty}
   * @readonly
   */
  fillMaterialProperty: {
    get: function () {
      return this._materialProperty;
    },
  },
  /**
   * Gets the material property used to fill the geometry when it fails the depth test.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {MaterialProperty}
   * @readonly
   */
  depthFailMaterialProperty: {
    get: function () {
      return this._depthFailMaterialProperty;
    },
  },
  /**
   * Gets a value indicating if the geometry has an outline component.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Boolean}
   * @readonly
   */
  outlineEnabled: {
    value: false,
  },
  /**
   * Gets a value indicating if outline visibility varies with simulation time.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Boolean}
   * @readonly
   */
  hasConstantOutline: {
    value: true,
  },
  /**
   * Gets the {@link Color} property for the geometry outline.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Property}
   * @readonly
   */
  outlineColorProperty: {
    value: undefined,
  },
  /**
   * Gets the property specifying whether the geometry
   * casts or receives shadows from light sources.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Property}
   * @readonly
   */
  shadowsProperty: {
    get: function () {
      return this._shadowsProperty;
    },
  },
  /**
   * Gets or sets the {@link DistanceDisplayCondition} Property specifying at what distance from the camera that this geometry will be displayed.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Property}
   * @readonly
   */
  distanceDisplayConditionProperty: {
    get: function () {
      return this._distanceDisplayConditionProperty;
    },
  },
  /**
   * Gets or sets the {@link ClassificationType} Property specifying if this geometry will classify terrain, 3D Tiles, or both when on the ground.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Property}
   * @readonly
   */
  classificationTypeProperty: {
    get: function () {
      return this._classificationTypeProperty;
    },
  },
  /**
   * Gets a value indicating if the geometry is time-varying.
   * If true, all visualization is delegated to the {@link DynamicGeometryUpdater}
   * returned by GeometryUpdater#createDynamicUpdater.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Boolean}
   * @readonly
   */
  isDynamic: {
    get: function () {
      return this._dynamic;
    },
  },
  /**
   * Gets a value indicating if the geometry is closed.
   * This property is only valid for static geometry.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Boolean}
   * @readonly
   */
  isClosed: {
    value: false,
  },
  /**
   * Gets an event that is raised whenever the public properties
   * of this updater change.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Boolean}
   * @readonly
   */
  geometryChanged: {
    get: function () {
      return this._geometryChanged;
    },
  },

  /**
   * Gets a value indicating if the path of the line.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {ArcType}
   * @readonly
   */
  arcType: {
    get: function () {
      return this._arcType;
    },
  },

  /**
   * Gets a value indicating if the geometry is clamped to the ground.
   * Returns false if polylines on terrain is not supported.
   * @memberof PolylineGeometryUpdater.prototype
   *
   * @type {Boolean}
   * @readonly
   */
  clampToGround: {
    get: function () {
      return this._clampToGround && this._supportsPolylinesOnTerrain;
    },
  },

  /**
   * Gets the zindex
   * @type {Number}
   * @memberof PolylineGeometryUpdater.prototype
   * @readonly
   */
  zIndex: {
    get: function () {
      return this._zIndex;
    },
  },
});

/**
 * Checks if the geometry is outlined at the provided time.
 *
 * @param {JulianDate} time The time for which to retrieve visibility.
 * @returns {Boolean} true if geometry is outlined at the provided time, false otherwise.
 */
PolylineGeometryUpdater.prototype.isOutlineVisible = function (time) {
  return false;
};

/**
 * Checks if the geometry is filled at the provided time.
 *
 * @param {JulianDate} time The time for which to retrieve visibility.
 * @returns {Boolean} true if geometry is filled at the provided time, false otherwise.
 */
PolylineGeometryUpdater.prototype.isFilled = function (time) {
  var entity = this._entity;
  var visible =
    this._fillEnabled &&
    entity.isAvailable(time) &&
    this._showProperty.getValue(time, null, entity);
  return defaultValue(visible, false);
};

/**
 * Creates the geometry instance which represents the fill of the geometry.
 *
 * @param {JulianDate} time The time to use when retrieving initial attribute values.
 * @returns {GeometryInstance} The geometry instance representing the filled portion of the geometry.
 *
 * @exception {DeveloperError} This instance does not represent a filled geometry.
 */
PolylineGeometryUpdater.prototype.createFillGeometryInstance = function (time) {
  //>>includeStart('debug', pragmas.debug);
  if (!defined(time)) {
    throw new DeveloperError("time is required.");
  }

  if (!this._fillEnabled) {
    throw new DeveloperError(
      "This instance does not represent a filled geometry."
    );
  }
  //>>includeEnd('debug');

  var entity = this._entity;
  var isAvailable = entity.isAvailable(time);
  var show = new ShowGeometryInstanceAttribute(
    isAvailable && entity.isShowing && this._showProperty.getValue(time, null, entity)
  );
  var distanceDisplayCondition = this._distanceDisplayConditionProperty.getValue(
    time,
    null,
    entity
  );
  var distanceDisplayConditionAttribute = DistanceDisplayConditionGeometryInstanceAttribute.fromDistanceDisplayCondition(
    distanceDisplayCondition
  );

  var attributes = {
    show: show,
    distanceDisplayCondition: distanceDisplayConditionAttribute,
  };

  var currentColor;
  if (this._materialProperty instanceof ColorMaterialProperty) {
    if (
      defined(this._materialProperty.color) &&
      (this._materialProperty.color.isConstant || isAvailable)
    ) {
      currentColor = this._materialProperty.color.getValue(time, scratchColor, entity);
    }
    if (!defined(currentColor)) {
      currentColor = Color.WHITE;
    }
    attributes.color = ColorGeometryInstanceAttribute.fromColor(currentColor);
  }

  if (this.clampToGround) {
    return new GeometryInstance({
      id: entity,
      geometry: new GroundPolylineGeometry(this._groundGeometryOptions),
      attributes: attributes,
    });
  }

  if (
    defined(this._depthFailMaterialProperty) &&
    this._depthFailMaterialProperty instanceof ColorMaterialProperty
  ) {
    if (
      defined(this._depthFailMaterialProperty.color) &&
      (this._depthFailMaterialProperty.color.isConstant || isAvailable)
    ) {
      currentColor = this._depthFailMaterialProperty.color.getValue(
        time,
        scratchColor,
        entity
      );
    }
    if (!defined(currentColor)) {
      currentColor = Color.WHITE;
    }
    attributes.depthFailColor = ColorGeometryInstanceAttribute.fromColor(
      currentColor
    );
  }

  return new GeometryInstance({
    id: entity,
    geometry: new PolylineGeometry(this._geometryOptions),
    attributes: attributes,
  });
};

/**
 * Creates the geometry instance which represents the outline of the geometry.
 *
 * @param {JulianDate} time The time to use when retrieving initial attribute values.
 * @returns {GeometryInstance} The geometry instance representing the outline portion of the geometry.
 *
 * @exception {DeveloperError} This instance does not represent an outlined geometry.
 */
PolylineGeometryUpdater.prototype.createOutlineGeometryInstance = function (
  time
) {
  //>>includeStart('debug', pragmas.debug);
  throw new DeveloperError(
    "This instance does not represent an outlined geometry."
  );
  //>>includeEnd('debug');
};

/**
 * Returns true if this object was destroyed; otherwise, false.
 *
 * @returns {Boolean} True if this object was destroyed; otherwise, false.
 */
PolylineGeometryUpdater.prototype.isDestroyed = function () {
  return false;
};

/**
 * Destroys and resources used by the object.  Once an object is destroyed, it should not be used.
 *
 * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
 */
PolylineGeometryUpdater.prototype.destroy = function () {
  this._entitySubscription();
  destroyObject(this);
};

PolylineGeometryUpdater.prototype._onEntityPropertyChanged = function (
  entity,
  propertyName,
  newValue,
  oldValue
) {
  if (!(propertyName === "availability" || propertyName === "polyline")) {
    return;
  }

  var polyline = this._entity.polyline;

  if (!defined(polyline)) {
    if (this._fillEnabled) {
      this._fillEnabled = false;
      this._geometryChanged.raiseEvent(this);
    }
    return;
  }

  var positionsProperty = polyline.positions;

  var show = polyline.show;
  if (
    (defined(show) &&
      show.isConstant &&
      !show.getValue(Iso8601.MINIMUM_VALUE, null, entity)) || //
    !defined(positionsProperty)
  ) {
    if (this._fillEnabled) {
      this._fillEnabled = false;
      this._geometryChanged.raiseEvent(this);
    }
    return;
  }

  var zIndex = polyline.zIndex;
  var material = defaultValue(polyline.material, defaultMaterial);
  var isColorMaterial = material instanceof ColorMaterialProperty;
  this._materialProperty = material;
  this._depthFailMaterialProperty = polyline.depthFailMaterial;
  this._showProperty = defaultValue(show, defaultShow);
  this._shadowsProperty = defaultValue(polyline.shadows, defaultShadows);
  this._distanceDisplayConditionProperty = defaultValue(
    polyline.distanceDisplayCondition,
    defaultDistanceDisplayCondition
  );
  this._classificationTypeProperty = defaultValue(
    polyline.classificationType,
    defaultClassificationType
  );
  this._fillEnabled = true;
  this._zIndex = defaultValue(zIndex, defaultZIndex);

  var width = polyline.width;
  var arcType = polyline.arcType;
  var clampToGround = polyline.clampToGround;
  var granularity = polyline.granularity;

  if (
    !positionsProperty.isConstant ||
    !Property.isConstant(width) ||
    !Property.isConstant(arcType) ||
    !Property.isConstant(granularity) ||
    !Property.isConstant(clampToGround) ||
    !Property.isConstant(zIndex)
  ) {
    if (!this._dynamic) {
      this._dynamic = true;
      this._geometryChanged.raiseEvent(this);
    }
  } else {
    var geometryOptions = this._geometryOptions;
    var positions = positionsProperty.getValue(
      Iso8601.MINIMUM_VALUE,
      geometryOptions.positions,
      entity
    );

    //Because of the way we currently handle reference properties,
    //we can't automatically assume the positions are always valid.
    if (!defined(positions) || positions.length < 2) {
      if (this._fillEnabled) {
        this._fillEnabled = false;
        this._geometryChanged.raiseEvent(this);
      }
      return;
    }

    var vertexFormat;
    if (
      isColorMaterial &&
      (!defined(this._depthFailMaterialProperty) ||
        this._depthFailMaterialProperty instanceof ColorMaterialProperty)
    ) {
      vertexFormat = PolylineColorAppearance.VERTEX_FORMAT;
    } else {
      vertexFormat = PolylineMaterialAppearance.VERTEX_FORMAT;
    }

    geometryOptions.vertexFormat = vertexFormat;
    geometryOptions.positions = positions;
    geometryOptions.width = defined(width)
      ? width.getValue(Iso8601.MINIMUM_VALUE, null, entity)
      : undefined;
    geometryOptions.arcType = defined(arcType)
      ? arcType.getValue(Iso8601.MINIMUM_VALUE, null, entity)
      : undefined;
    geometryOptions.granularity = defined(granularity)
      ? granularity.getValue(Iso8601.MINIMUM_VALUE, null, entity)
      : undefined;

    var groundGeometryOptions = this._groundGeometryOptions;
    groundGeometryOptions.positions = positions;
    groundGeometryOptions.width = geometryOptions.width;
    groundGeometryOptions.arcType = geometryOptions.arcType;
    groundGeometryOptions.granularity = geometryOptions.granularity;

    this._clampToGround = defined(clampToGround)
      ? clampToGround.getValue(Iso8601.MINIMUM_VALUE, null, entity)
      : false;

    if (!this._clampToGround && defined(zIndex)) {
      oneTimeWarning(
        "Entity polylines must have clampToGround: true when using zIndex.  zIndex will be ignored."
      );
    }

    this._dynamic = false;
    this._geometryChanged.raiseEvent(this);
  }
};

/**
 * Creates the dynamic updater to be used when GeometryUpdater#isDynamic is true.
 *
 * @param {PrimitiveCollection} primitives The primitive collection to use.
 * @param {PrimitiveCollection|OrderedGroundPrimitiveCollection} groundPrimitives The primitive collection to use for ordered ground primitives.
 * @returns {DynamicGeometryUpdater} The dynamic updater used to update the geometry each frame.
 *
 * @exception {DeveloperError} This instance does not represent dynamic geometry.
 * @private
 */
PolylineGeometryUpdater.prototype.createDynamicUpdater = function (
  primitives,
  groundPrimitives
) {
  //>>includeStart('debug', pragmas.debug);
  Check.defined("primitives", primitives);
  Check.defined("groundPrimitives", groundPrimitives);

  if (!this._dynamic) {
    throw new DeveloperError(
      "This instance does not represent dynamic geometry."
    );
  }
  //>>includeEnd('debug');

  return new DynamicGeometryUpdater(primitives, groundPrimitives, this);
};

/**
 * @private
 */
var generateCartesianArcOptions = {
  positions: undefined,
  granularity: undefined,
  height: undefined,
  ellipsoid: undefined,
};

function DynamicGeometryUpdater(primitives, groundPrimitives, geometryUpdater) {
  this._line = undefined;
  this._primitives = primitives;
  this._groundPrimitives = groundPrimitives;
  this._groundPolylinePrimitive = undefined;
  this._material = undefined;
  this._geometryUpdater = geometryUpdater;
  this._positions = [];
}

function getLine(dynamicGeometryUpdater) {
  if (defined(dynamicGeometryUpdater._line)) {
    return dynamicGeometryUpdater._line;
  }

  var sceneId = dynamicGeometryUpdater._geometryUpdater._scene.id;
  var polylineCollection = polylineCollections[sceneId];
  var primitives = dynamicGeometryUpdater._primitives;
  if (!defined(polylineCollection) || polylineCollection.isDestroyed()) {
    polylineCollection = new PolylineCollection();
    polylineCollections[sceneId] = polylineCollection;
    primitives.add(polylineCollection);
  } else if (!primitives.contains(polylineCollection)) {
    primitives.add(polylineCollection);
  }

  var line = polylineCollection.add();
  line.id = dynamicGeometryUpdater._geometryUpdater._entity;
  dynamicGeometryUpdater._line = line;
  return line;
}

DynamicGeometryUpdater.prototype.update = function (time) {
  var geometryUpdater = this._geometryUpdater;
  var entity = geometryUpdater._entity;
  var polyline = entity.polyline;

  var positionsProperty = polyline.positions;
  var positions = Property.getValueOrUndefined(
    positionsProperty,
    time,
    this._positions,
    entity
  );

  // Synchronize with geometryUpdater for GroundPolylinePrimitive
  geometryUpdater._clampToGround = Property.getValueOrDefault(
    polyline._clampToGround,
    time,
    false,
    null,
    entity
  );
  geometryUpdater._groundGeometryOptions.positions = positions;
  geometryUpdater._groundGeometryOptions.width = Property.getValueOrDefault(
    polyline._width,
    time,
    1,
    null,
    entity
  );
  geometryUpdater._groundGeometryOptions.arcType = Property.getValueOrDefault(
    polyline._arcType,
    time,
    ArcType.GEODESIC,
    null,
    entity
  );
  geometryUpdater._groundGeometryOptions.granularity = Property.getValueOrDefault(
    polyline._granularity,
    time,
    9999,
    null,
    entity
  );

  var groundPrimitives = this._groundPrimitives;

  if (defined(this._groundPolylinePrimitive)) {
    groundPrimitives.remove(this._groundPolylinePrimitive); // destroys by default
    this._groundPolylinePrimitive = undefined;
  }

  if (geometryUpdater.clampToGround) {
    if (
      !entity.isShowing ||
      !entity.isAvailable(time) ||
      !Property.getValueOrDefault(polyline._show, time, true, null, entity)
    ) {
      return;
    }

    if (!defined(positions) || positions.length < 2) {
      return;
    }

    var fillMaterialProperty = geometryUpdater.fillMaterialProperty;
    var appearance;
    if (fillMaterialProperty instanceof ColorMaterialProperty) {
      appearance = new PolylineColorAppearance();
    } else {
      var material = MaterialProperty.getValue(
        time,
        fillMaterialProperty,
        this._material,
        entity
      );
      appearance = new PolylineMaterialAppearance({
        material: material,
        translucent: material.isTranslucent(),
      });
      this._material = material;
    }

    this._groundPolylinePrimitive = groundPrimitives.add(
      new GroundPolylinePrimitive({
        geometryInstances: geometryUpdater.createFillGeometryInstance(time),
        appearance: appearance,
        classificationType: geometryUpdater.classificationTypeProperty.getValue(
          time,
          null,
          entity
        ),
        asynchronous: false,
      }),
      Property.getValueOrUndefined(geometryUpdater.zIndex, time, null, entity)
    );

    // Hide the polyline in the collection, if any
    if (defined(this._line)) {
      this._line.show = false;
    }
    return;
  }

  var line = getLine(this);

  if (
    !entity.isShowing ||
    !entity.isAvailable(time) ||
    !Property.getValueOrDefault(polyline._show, time, true, null, entity)
  ) {
    line.show = false;
    return;
  }

  if (!defined(positions) || positions.length < 2) {
    line.show = false;
    return;
  }

  var arcType = ArcType.GEODESIC;
  arcType = Property.getValueOrDefault(polyline._arcType, time, arcType, null, entity);

  var globe = geometryUpdater._scene.globe;
  if (arcType !== ArcType.NONE && defined(globe)) {
    generateCartesianArcOptions.ellipsoid = globe.ellipsoid;
    generateCartesianArcOptions.positions = positions;
    generateCartesianArcOptions.granularity = Property.getValueOrUndefined(
      polyline._granularity,
      time,
      null,
      entity
    );
    generateCartesianArcOptions.height = PolylinePipeline.extractHeights(
      positions,
      globe.ellipsoid
    );
    if (arcType === ArcType.GEODESIC) {
      positions = PolylinePipeline.generateCartesianArc(
        generateCartesianArcOptions
      );
    } else {
      positions = PolylinePipeline.generateCartesianRhumbArc(
        generateCartesianArcOptions
      );
    }
  }

  line.show = true;
  line.positions = positions.slice();
  line.material = MaterialProperty.getValue(
    time,
    geometryUpdater.fillMaterialProperty,
    line.material,
    entity
  );
  line.width = Property.getValueOrDefault(polyline._width, time, 1, null, entity);
  line.distanceDisplayCondition = Property.getValueOrUndefined(
    polyline._distanceDisplayCondition,
    time,
    line.distanceDisplayCondition,
    entity
  );
};

DynamicGeometryUpdater.prototype.getBoundingSphere = function (result) {
  //>>includeStart('debug', pragmas.debug);
  Check.defined("result", result);
  //>>includeEnd('debug');

  if (!this._geometryUpdater.clampToGround) {
    var line = getLine(this);
    if (line.show && line.positions.length > 0) {
      BoundingSphere.fromPoints(line.positions, result);
      return BoundingSphereState.DONE;
    }
  } else {
    var groundPolylinePrimitive = this._groundPolylinePrimitive;
    if (
      defined(groundPolylinePrimitive) &&
      groundPolylinePrimitive.show &&
      groundPolylinePrimitive.ready
    ) {
      var attributes = groundPolylinePrimitive.getGeometryInstanceAttributes(
        this._geometryUpdater._entity
      );
      if (defined(attributes) && defined(attributes.boundingSphere)) {
        BoundingSphere.clone(attributes.boundingSphere, result);
        return BoundingSphereState.DONE;
      }
    }

    if (defined(groundPolylinePrimitive) && !groundPolylinePrimitive.ready) {
      return BoundingSphereState.PENDING;
    }

    return BoundingSphereState.DONE;
  }

  return BoundingSphereState.FAILED;
};

DynamicGeometryUpdater.prototype.isDestroyed = function () {
  return false;
};

DynamicGeometryUpdater.prototype.destroy = function () {
  var geometryUpdater = this._geometryUpdater;
  var sceneId = geometryUpdater._scene.id;
  var polylineCollection = polylineCollections[sceneId];
  if (defined(polylineCollection)) {
    polylineCollection.remove(this._line);
    if (polylineCollection.length === 0) {
      this._primitives.removeAndDestroy(polylineCollection);
      delete polylineCollections[sceneId];
    }
  }
  if (defined(this._groundPolylinePrimitive)) {
    this._groundPrimitives.remove(this._groundPolylinePrimitive);
  }
  destroyObject(this);
};
export default PolylineGeometryUpdater;
