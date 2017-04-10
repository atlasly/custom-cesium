/*global define*/
define([
        '../Core/Color',
        '../Core/ComponentDatatype',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/defineProperties',
        '../Core/deprecationWarning',
        '../Core/destroyObject',
        '../Core/DeveloperError',
        '../Core/getAbsoluteUri',
        '../Core/getBaseUri',
        '../Core/getMagic',
        '../Core/getStringFromTypedArray',
        '../Core/loadArrayBuffer',
        '../Core/Request',
        '../Core/RequestScheduler',
        '../Core/RequestType',
        '../ThirdParty/when',
        './Cesium3DTileBatchTable',
        './Cesium3DTileContentState',
        './Cesium3DTileFeature',
        './Cesium3DTileFeatureTable',
        './getAttributeOrUniformBySemantic',
        './Model'
    ], function(
        Color,
        ComponentDatatype,
        defaultValue,
        defined,
        defineProperties,
        deprecationWarning,
        destroyObject,
        DeveloperError,
        getAbsoluteUri,
        getBaseUri,
        getMagic,
        getStringFromTypedArray,
        loadArrayBuffer,
        Request,
        RequestScheduler,
        RequestType,
        when,
        Cesium3DTileBatchTable,
        Cesium3DTileContentState,
        Cesium3DTileFeature,
        Cesium3DTileFeatureTable,
        getAttributeOrUniformBySemantic,
        Model) {
    'use strict';

    /**
     * Represents the contents of a
     * {@link https://github.com/AnalyticalGraphicsInc/3d-tiles/blob/master/TileFormats/Batched3DModel/README.md|Batched 3D Model}
     * tile in a {@link https://github.com/AnalyticalGraphicsInc/3d-tiles/blob/master/README.md|3D Tiles} tileset.
     *
     * @alias Batched3DModel3DTileContent
     * @constructor
     *
     * @private
     */
    function Batched3DModel3DTileContent(tileset, tile, url) {
        this._model = undefined;
        this._url = url;
        this._tileset = tileset;
        this._tile = tile;

        /**
         * The following properties are part of the {@link Cesium3DTileContent} interface.
         */
        this.state = Cesium3DTileContentState.UNLOADED;
        this.batchTable = undefined;
        this.featurePropertiesDirty = false;

        this._contentReadyToProcessPromise = when.defer();
        this._readyPromise = when.defer();
        this._featuresLength = 0;
        this._features = undefined;
    }

    // This can be overridden for testing purposes
    Batched3DModel3DTileContent._deprecationWarning = deprecationWarning;

    defineProperties(Batched3DModel3DTileContent.prototype, {
        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        featuresLength : {
            get : function() {
                return this._featuresLength;
            }
        },

        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        pointsLength : {
            get : function() {
                return 0;
            }
        },

        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        trianglesLength : {
            get : function() {
                if (defined(this._model)) {
                    return this._model.trianglesLength;
                }
                return 0;
            }
        },

        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        vertexMemorySizeInBytes : {
            get : function() {
                if (defined(this._model)) {
                    return this._model.vertexMemorySizeInBytes;
                }
                return 0;
            }
        },

        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        textureMemorySizeInBytes : {
            get : function() {
                if (defined(this._model)) {
                    return this._model.textureMemorySizeInBytes;
                }
                return 0;
            }
        },

        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        batchTableMemorySizeInBytes : {
            get : function() {
                if (defined(this.batchTable)) {
                    return this.batchTable.memorySizeInBytes;
                }
                return 0;
            }
        },

        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        innerContents : {
            get : function() {
                return undefined;
            }
        },

        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        contentReadyToProcessPromise : {
            get : function() {
                return this._contentReadyToProcessPromise.promise;
            }
        },

        /**
         * Part of the {@link Cesium3DTileContent} interface.
         */
        readyPromise : {
            get : function() {
                return this._readyPromise.promise;
            }
        }
    });

    function createFeatures(content) {
        var tileset = content._tileset;
        var featuresLength = content._featuresLength;
        if (!defined(content._features) && (featuresLength > 0)) {
            var features = new Array(featuresLength);
            for (var i = 0; i < featuresLength; ++i) {
                features[i] = new Cesium3DTileFeature(tileset, content, i);
            }
            content._features = features;
        }
    }

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Batched3DModel3DTileContent.prototype.hasProperty = function(batchId, name) {
        return this.batchTable.hasProperty(batchId, name);
    };

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Batched3DModel3DTileContent.prototype.getFeature = function(batchId) {
        var featuresLength = this._featuresLength;
        //>>includeStart('debug', pragmas.debug);
        if (!defined(batchId) || (batchId < 0) || (batchId >= featuresLength)) {
            throw new DeveloperError('batchId is required and between zero and featuresLength - 1 (' + (featuresLength - 1) + ').');
        }
        //>>includeEnd('debug');

        createFeatures(this);
        return this._features[batchId];
    };

    var sizeOfUint32 = Uint32Array.BYTES_PER_ELEMENT;

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Batched3DModel3DTileContent.prototype.request = function() {
        var that = this;

        var distance = this._tile.distanceToCamera;
        var promise = RequestScheduler.schedule(new Request({
            url : this._url,
            server : this._tile.requestServer,
            requestFunction : loadArrayBuffer,
            type : RequestType.TILES3D,
            distance : distance
        }));

        if (!defined(promise)) {
            return false;
        }

        this.state = Cesium3DTileContentState.LOADING;
        promise.then(function(arrayBuffer) {
            if (that.isDestroyed()) {
                return when.reject('tileset is destroyed');
            }
            that.initialize(arrayBuffer);
        }).otherwise(function(error) {
            that.state = Cesium3DTileContentState.FAILED;
            that._readyPromise.reject(error);
        });
        return true;
    };

    function getBatchIdAttributeName(gltf) {
        var batchIdAttributeName = getAttributeOrUniformBySemantic(gltf, '_BATCHID');
        if (!defined(batchIdAttributeName)) {
            batchIdAttributeName = getAttributeOrUniformBySemantic(gltf, 'BATCHID');
            if (defined(batchIdAttributeName)) {
                Batched3DModel3DTileContent._deprecationWarning('b3dm-legacy-batchid', 'The glTF in this b3dm uses the semantic `BATCHID`. Application-specific semantics should be prefixed with an underscore: `_BATCHID`.');
            }
        }
        return batchIdAttributeName;
    }

    function getVertexShaderCallback(content) {
        return function(vs) {
            var batchTable = content.batchTable;
            var gltf = content._model.gltf;
            var batchIdAttributeName = getBatchIdAttributeName(gltf);
            var callback = batchTable.getVertexShaderCallback(true, batchIdAttributeName);
            return defined(callback) ? callback(vs) : vs;
        };
    }

    function getPickVertexShaderCallback(content) {
        return function(vs) {
            var batchTable = content.batchTable;
            var gltf = content._model.gltf;
            var batchIdAttributeName = getBatchIdAttributeName(gltf);
            var callback = batchTable.getPickVertexShaderCallback(batchIdAttributeName);
            return defined(callback) ? callback(vs) : vs;
        };
    }

    function getFragmentShaderCallback(content) {
        return function(fs) {
            var batchTable = content.batchTable;
            var gltf = content._model.gltf;
            var diffuseUniformName = getAttributeOrUniformBySemantic(gltf, '_3DTILESDIFFUSE');
            var callback = batchTable.getFragmentShaderCallback(true, diffuseUniformName);
            return defined(callback) ? callback(fs) : fs;
        };
    }

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Batched3DModel3DTileContent.prototype.initialize = function(arrayBuffer, byteOffset) {
        var byteStart = defaultValue(byteOffset, 0);
        byteOffset = byteStart;

        var uint8Array = new Uint8Array(arrayBuffer);
        var magic = getMagic(uint8Array, byteOffset);
        if (magic !== 'b3dm') {
            throw new DeveloperError('Invalid Batched 3D Model.  Expected magic=b3dm.  Read magic=' + magic);
        }

        var view = new DataView(arrayBuffer);
        byteOffset += sizeOfUint32;  // Skip magic number

        //>>includeStart('debug', pragmas.debug);
        var version = view.getUint32(byteOffset, true);
        if (version !== 1) {
            throw new DeveloperError('Only Batched 3D Model version 1 is supported.  Version ' + version + ' is not.');
        }
        //>>includeEnd('debug');
        byteOffset += sizeOfUint32;

        var byteLength = view.getUint32(byteOffset, true);
        byteOffset += sizeOfUint32;

        var featureTableJsonByteLength = view.getUint32(byteOffset, true);
        byteOffset += sizeOfUint32;

        var featureTableBinaryByteLength = view.getUint32(byteOffset, true);
        byteOffset += sizeOfUint32;

        var batchTableJsonByteLength = view.getUint32(byteOffset, true);
        byteOffset += sizeOfUint32;

        var batchTableBinaryByteLength = view.getUint32(byteOffset, true);
        byteOffset += sizeOfUint32;

        var batchLength;

        // TODO : remove this legacy check before merging into master
        // Legacy header #1: [batchLength] [batchTableByteLength]
        // Legacy header #2: [batchTableJsonByteLength] [batchTableBinaryByteLength] [batchLength]
        // Current header: [featureTableJsonByteLength] [featureTableBinaryByteLength] [batchTableJsonByteLength] [batchTableBinaryByteLength]
        // If the header is in the first legacy format 'batchTableJsonByteLength' will be the start of the JSON string (a quotation mark) or the glTF magic.
        // Accordingly its first byte will be either 0x22 or 0x67, and so the minimum uint32 expected is 0x22000000 = 570425344 = 570MB. It is unlikely that the feature table JSON will exceed this length.
        // The check for the second legacy format is similar, except it checks 'batchTableBinaryByteLength' instead
        if (batchTableJsonByteLength >= 570425344) {
            // First legacy check
            byteOffset -= sizeOfUint32 * 2;
            batchLength = featureTableJsonByteLength;
            batchTableJsonByteLength = featureTableBinaryByteLength;
            batchTableBinaryByteLength = 0;
            featureTableJsonByteLength = 0;
            featureTableBinaryByteLength = 0;
            deprecationWarning('b3dm-legacy-header', 'This b3dm header is using the legacy format [batchLength] [batchTableByteLength]. The new format is [featureTableJsonByteLength] [featureTableBinaryByteLength] [batchTableJsonByteLength] [batchTableBinaryByteLength] from https://github.com/AnalyticalGraphicsInc/3d-tiles/blob/master/TileFormats/Batched3DModel/README.md.');
        } else if (batchTableBinaryByteLength >= 570425344) {
            // Second legacy check
            byteOffset -= sizeOfUint32;
            batchLength = batchTableJsonByteLength;
            batchTableJsonByteLength = featureTableJsonByteLength;
            batchTableBinaryByteLength = featureTableBinaryByteLength;
            featureTableJsonByteLength = 0;
            featureTableBinaryByteLength = 0;
            deprecationWarning('b3dm-legacy-header', 'This b3dm header is using the legacy format [batchTableJsonByteLength] [batchTableBinaryByteLength] [batchLength]. The new format is [featureTableJsonByteLength] [featureTableBinaryByteLength] [batchTableJsonByteLength] [batchTableBinaryByteLength] from https://github.com/AnalyticalGraphicsInc/3d-tiles/blob/master/TileFormats/Batched3DModel/README.md.');
        }

        var featureTableJson;
        if (featureTableJsonByteLength === 0) {
            featureTableJson = {
                BATCH_LENGTH : defaultValue(batchLength, 0)
            };
        } else {
            var featureTableString = getStringFromTypedArray(uint8Array, byteOffset, featureTableJsonByteLength);
            featureTableJson = JSON.parse(featureTableString);
            byteOffset += featureTableJsonByteLength;
        }

        var featureTableBinary = new Uint8Array(arrayBuffer, byteOffset, featureTableBinaryByteLength);
        byteOffset += featureTableBinaryByteLength;

        var featureTable = new Cesium3DTileFeatureTable(featureTableJson, featureTableBinary);

        batchLength = featureTable.getGlobalProperty('BATCH_LENGTH', ComponentDatatype.UNSIGNED_INT);
        featureTable.featuresLength = batchLength;
        this._featuresLength = batchLength;

        var batchTableJson;
        var batchTableBinary;
        if (batchTableJsonByteLength > 0) {
            // PERFORMANCE_IDEA: is it possible to allocate this on-demand?  Perhaps keep the
            // arraybuffer/string compressed in memory and then decompress it when it is first accessed.
            //
            // We could also make another request for it, but that would make the property set/get
            // API async, and would double the number of numbers in some cases.
            var batchTableString = getStringFromTypedArray(uint8Array, byteOffset, batchTableJsonByteLength);
            batchTableJson = JSON.parse(batchTableString);
            byteOffset += batchTableJsonByteLength;

            if (batchTableBinaryByteLength > 0) {
                // Has a batch table binary
                batchTableBinary = new Uint8Array(arrayBuffer, byteOffset, batchTableBinaryByteLength);
                // Copy the batchTableBinary section and let the underlying ArrayBuffer be freed
                batchTableBinary = new Uint8Array(batchTableBinary);
                byteOffset += batchTableBinaryByteLength;
            }
        }

        var batchTable = new Cesium3DTileBatchTable(this, batchLength, batchTableJson, batchTableBinary);
        this.batchTable = batchTable;

        var gltfByteLength = byteStart + byteLength - byteOffset;
        var gltfView = new Uint8Array(arrayBuffer, byteOffset, gltfByteLength);

        // PERFORMANCE_IDEA: patch the shader on demand, e.g., the first time show/color changes.
        // The pick shader still needs to be patched.
        var model = new Model({
            gltf : gltfView,
            cull : false,           // The model is already culled by the 3D tiles
            releaseGltfJson : true, // Models are unique and will not benefit from caching so save memory
            basePath : getAbsoluteUri(getBaseUri(this._url, true)),
            modelMatrix : this._tile.computedTransform,
            upAxis : this._tileset._gltfUpAxis,
            shadows: this._tileset.shadows,
            debugWireframe: this._tileset.debugWireframe,
            incrementallyLoadTextures : false,
            pickPrimitive : this._tileset,
            vertexShaderLoaded : getVertexShaderCallback(this),
            fragmentShaderLoaded : getFragmentShaderCallback(this),
            uniformMapLoaded : batchTable.getUniformMapCallback(),
            pickVertexShaderLoaded : getPickVertexShaderCallback(this),
            pickFragmentShaderLoaded : batchTable.getPickFragmentShaderCallback(),
            pickUniformMapLoaded : batchTable.getPickUniformMapCallback(),
            addBatchIdToGeneratedShaders : (batchLength > 0) // If the batch table has values in it, generated shaders will need a batchId attribute
        });

        this._model = model;
        this.state = Cesium3DTileContentState.PROCESSING;
        this._contentReadyToProcessPromise.resolve(this);

        var that = this;

        model.readyPromise.then(function(model) {
            that.state = Cesium3DTileContentState.READY;
            that._readyPromise.resolve(that);
        }).otherwise(function(error) {
            that.state = Cesium3DTileContentState.FAILED;
            that._readyPromise.reject(error);
        });
    };

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Batched3DModel3DTileContent.prototype.applyDebugSettings = function(enabled, color) {
        color = enabled ? color : Color.WHITE;
        this.batchTable.setAllColor(color);
    };

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Batched3DModel3DTileContent.prototype.applyStyleWithShader = function(frameState, style) {
        return false;
    };

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Batched3DModel3DTileContent.prototype.update = function(tileset, frameState) {
        var oldAddCommand = frameState.addCommand;
        if (frameState.passes.render) {
            frameState.addCommand = this.batchTable.getAddCommand();
        }

        // In the PROCESSING state we may be calling update() to move forward
        // the content's resource loading.  In the READY state, it will
        // actually generate commands.
        this.batchTable.update(tileset, frameState);
        this._model.modelMatrix = this._tile.computedTransform;
        this._model.shadows = this._tileset.shadows;
        this._model.debugWireframe = this._tileset.debugWireframe;
        this._model.update(frameState);

        frameState.addCommand = oldAddCommand;
   };

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Batched3DModel3DTileContent.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Part of the {@link Cesium3DTileContent} interface.
     */
    Batched3DModel3DTileContent.prototype.destroy = function() {
        this._model = this._model && this._model.destroy();
        this.batchTable = this.batchTable && this.batchTable.destroy();
        return destroyObject(this);
    };

    return Batched3DModel3DTileContent;
});
