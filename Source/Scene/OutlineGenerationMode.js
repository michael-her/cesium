/**
 * Defines different modes for automatically generating outlines for models.
 *
 * USE_MODEL_SETTINGS will follow whatever is set in the glTF underlying the model.
 * OFF forces outlines to not be generated, overriding what is specified in the model.
 * ON forces outlines to be generated, overriding what is specified in the model.
 *
 * @enum {Number}
 *
 * @see Model.generateOutlines
 */
var OutlineGenerationMode = {
  OFF: 0,
  ON: 1,
  USE_GLTF_SETTINGS: 2,
};

export default Object.freeze(OutlineGenerationMode);
