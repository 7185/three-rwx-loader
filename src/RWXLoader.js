/**
 * @author Julien 'Blaxar' Bardagi <blaxar.waldarax@gmail.com>
 */

import {
	FileLoader,
	Loader,
	Mesh,
	Vector2,
	Vector3,
	Matrix4,
	Vector4,
	MathUtils,
	MeshPhongMaterial,
	BufferGeometry,
	Quaternion,
	Plane,
	Shape,
	ShapeBufferGeometry,
	TextureLoader,
	RepeatWrapping,
	FrontSide,
	DoubleSide,
	Group,
	BufferAttribute,
	EdgesGeometry,
	LineSegments,
	LineBasicMaterial
} from 'three';

const LightSampling = {
	FACET: 1,
	VERTEX: 2
};

const GeometrySampling = {
	POINTCLOUD: 1,
	WIREFRAME: 2,
	SOLID: 3
};

const TextureMode = {
	LIT: 1,
	FORESHORTEN: 2,
	FILTER: 3
};

const MaterialMode = {
	NONE: 0,
	NULL: 1,
	DOUBLE: 2
};

function getFinalTransform( ctx ) {

	let transform = new Matrix4();

	ctx.transformStack.forEach( ( t ) => {

		transform.multiply( t );

	} );

	return transform.multiply( ctx.currentTransform );

}

function triangulateFacesWithShapes( vertices, uvs, loop ) {

	// Mostly crediting @neeh for their answer: https://stackoverflow.com/a/42402681
	const _ctr = new Vector3();

	let _basis = new Matrix4();
	const _plane = new Plane();
	const _q = new Quaternion();
	const _y = new Vector3();
	const _x = new Vector3();

	const X = new Vector3( 1.0, 0.0, 0.0 );
	const Z = new Vector3( 0.0, 0.0, 1.0 );

	let _tmp = new Vector3();

	let newVertices = [];
	let newUvs = [];
	let faces = [];

	let offset = vertices.length / 3;
	let vertexMap = {};

	// Compute centroid
	_ctr.setScalar( 0.0 );

	let l = loop.length;
	for ( let i = 0; i < l; i ++ ) {

		_ctr.add( new Vector3( vertices[ loop[ i ] * 3 ], vertices[ loop[ i ] * 3 + 1 ], vertices[ loop[ i ] * 3 + 2 ] ) );
		vertexMap[ i ] = loop[ i ];

	}

	_ctr.multiplyScalar( 1.0 / l );

	let loopNormal = new Vector3( 0.0, 0.0, 0.0 );

	// Compute loop normal using Newell's Method
	for ( let i = 0, len = loop.length; i < len; i ++ ) {

		const currentVertex = new Vector3( vertices[ loop[ i ] * 3 ], vertices[ loop[ i ] * 3 + 1 ], vertices[ loop[ i ] * 3 + 2 ] );

		let nextVertex = new Vector3(
			vertices[ loop[ ( ( i + 1 ) % len ) ] * 3 ],
			vertices[ loop[ ( ( i + 1 ) % len ) ] * 3 + 1 ],
		  vertices[ loop[ ( ( i + 1 ) % len ) ] * 3 + 2 ]
		);

		loopNormal.x += ( currentVertex.y - nextVertex.y ) * ( currentVertex.z + nextVertex.z );
		loopNormal.y += ( currentVertex.z - nextVertex.z ) * ( currentVertex.x + nextVertex.x );
		loopNormal.z += ( currentVertex.x - nextVertex.x ) * ( currentVertex.y + nextVertex.y );

	}

	loopNormal.normalize();

	const coplanarVertex = new Vector3( vertices[ loop[ 0 ] * 3 ], vertices[ loop[ 0 ] * 3 + 1 ], vertices[ loop[ 0 ] * 3 + 2 ] );
	_plane.setFromNormalAndCoplanarPoint( loopNormal, coplanarVertex );
	let _z = _plane.normal;

	// Compute basis
	_q.setFromUnitVectors( Z, _z );
	_x.copy( X ).applyQuaternion( _q );
	_y.crossVectors( _x, _z );
	_y.normalize();
	_basis.makeBasis( _x, _y, _z );
	_basis.setPosition( _ctr );

	// Project the 3D vertices on the 2D plane
	let projVertices = [];
	for ( let i = 0; i < l; i ++ ) {

		const currentVertex = new Vector3( vertices[ loop[ i ] * 3 ], vertices[ loop[ i ] * 3 + 1 ], vertices[ loop[ i ] * 3 + 2 ] );
		_tmp.subVectors( currentVertex, _ctr );
		projVertices.push( new Vector2( _tmp.dot( _x ), _tmp.dot( _y ) ) );
		newUvs.push( uvs[ loop[ i ] * 2 ], uvs[ loop[ i ] * 2 + 1 ] );

	}

	// Create the geometry (Three.js triangulation with ShapeGeometry)
	let shape = new Shape( projVertices );
	let geometry = new ShapeBufferGeometry( shape );

	geometry.applyMatrix4( _basis );

	let bufferPosition = geometry.getAttribute( 'position' );
	const shapeIndices = geometry.getIndex().array;

	/*
	* Replace the positions for each vertex in the newly computed (flat and planar) polygon with the ones from the original
	* set of vertices it was fed with, thus "sealing" the geometry perfectly despite the vertices being duplicated.
	*/
	for ( let i = 0, lVertices = bufferPosition.count; i < lVertices; i ++ ) {

		bufferPosition.setXYZ(
			i,
			vertices[ vertexMap[ i ] * 3 ],
			vertices[ vertexMap [ i ] * 3 + 1 ],
			vertices[ vertexMap [ i ] * 3 + 2 ]
		);

	}

	// Use the vertex indices from each newly computed 2D face to extend our current set
	for ( let i = 0, lFaces = shapeIndices.length; i < lFaces; i ++ ) {

		faces.push( shapeIndices[ i ] + offset );

	}

	newVertices.push( ...bufferPosition.array );

	return [ newVertices, newUvs, faces ];

}

function makeThreeMaterial( rwxMaterial, folder, texExtension = "jpg", maskExtension =
  "zip", jsZip = null, jsZipUtils = null ) {

	let materialDict = { name: rwxMaterial.getMatSignature() };

	if ( rwxMaterial.materialmode == MaterialMode.NULL ) {

		materialDict[ 'side' ] = FrontSide;

	} else if ( rwxMaterial.materialmode == MaterialMode.DOUBLE ) {

		materialDict[ 'side' ] = DoubleSide;

	} else if ( rwxMaterial.materialmode == MaterialMode.NONE ) {

		materialDict[ 'visible' ] = false;

	}

	if ( rwxMaterial.opacity < 1.0 ) {

		materialDict[ 'transparent' ] = true;

	}

	if ( rwxMaterial.lightsampling == LightSampling.FACET ) {

		materialDict[ 'flatShading' ] = true;

	} else if ( rwxMaterial.lightsampling == LightSampling.VERTEX ) {

		materialDict[ 'flatShading' ] = false;

	}

	if ( rwxMaterial.geometrysampling < GeometrySampling.SOLID ) {

		// For the time being: we treat 'wireframe' and 'pointcloud' the same, as 'pointcloud' is not yet trivially
		// supported
		materialDict[ 'wireframe' ] = true;

	} else {

		materialDict[ 'wireframe' ] = false;

	}

	// The specular value in a Phong material is expressed using an hexadecimal value
	// holding on 3 bytes, each representing a different color channel.
	// Without any prior knowledge: we safely assume a white light instead
	const whiteSpecular = Math.trunc( rwxMaterial.surface[ 2 ] * 255 );
	materialDict[ 'specular' ] = ( whiteSpecular << 16 ) + ( whiteSpecular << 8 ) + whiteSpecular;

	// Same thing for the emissive value
	const whiteEmissive = Math.trunc( rwxMaterial.surface[ 1 ] );
	materialDict[ 'emissive' ] = ( whiteEmissive << 16 ) + ( whiteEmissive << 8 ) + whiteEmissive;

	materialDict[ 'shininess' ] = 30; // '30' is the demo's default Phong material shininess value
	materialDict[ 'opacity' ] = rwxMaterial.opacity;

	let phongMat = new MeshPhongMaterial( materialDict );
	let loadingPromises = [];

	phongMat.userData[ 'collision' ] = rwxMaterial.collision;

	if ( rwxMaterial.texture == null ) {

		phongMat.color.set( rwxMaterial.getColorHexValue() );

	} else {

		// TODO: try to instanciate once
		let loader = new TextureLoader();

		loadingPromises.push(new Promise ( ( resolveTex, rejectTex ) => {

			let texturePath = folder + '/' + rwxMaterial.texture + '.' + texExtension;
			loader.load( texturePath, ( texture ) => {

				texture.wrapS = RepeatWrapping;
				texture.wrapT = RepeatWrapping;
				phongMat.map = texture;
				phongMat.needsUpdate = true;
				resolveTex(texture);

			});

		}));

		if ( rwxMaterial.mask != null ) {

			phongMat.alphaTest = 0.2;
			phongMat.transparent = true;

			if ( maskExtension == "zip" && jsZip != null && jsZipUtils != null ) {

				// We try to extract the bmp mask from the archive
				const zipPath = folder + '/' + rwxMaterial.mask + '.' + maskExtension;

				// We load the mask asynchronously using JSZip and JSZipUtils (if available)
				loadingPromises.push( new jsZip.external.Promise( function ( resolve, reject ) {

					jsZipUtils.getBinaryContent( zipPath, function ( err, data ) {

						if ( err ) {

							reject( err );

						} else {

							resolve( data );

						}

					} );

				} ).then( jsZip.loadAsync ).then( function ( zip ) {

					// Chain with the bmp content promise, uppercase and lowercase extensions are both possible
					if ( zip.file( rwxMaterial.mask + '.bmp' ) ) {

						return zip.file( rwxMaterial.mask + '.bmp' ).async( "uint8array" );

					} else if ( zip.file( rwxMaterial.mask + '.BMP' ) ) {

						return zip.file( rwxMaterial.mask + '.BMP' ).async( "uint8array" );

					}

				} ).then( function success( buffer ) {

					// Load the bmp image into a data uri string
					let bmpURI = "data:image/bmp;base64,";
					const chunkSize = 4056;
					let dataStr = "";

					// Chunking the buffer to maximize browser compatibility and avoid exceeding some size limit
					// during string creation when using 'String.fromCharCode'
					for ( let i = 0; i < buffer.length; i += chunkSize ) {

						dataStr = dataStr.concat( String.fromCharCode.apply( null, new Uint16Array( buffer.slice( i, i + chunkSize ) ) ) );

					}

					bmpURI = bmpURI.concat( btoa( dataStr ) );

					// Make a texture out of the bmp mask, apply it to the material
					let maskTexture = loader.load( bmpURI );
					maskTexture.wrapS = RepeatWrapping;
					maskTexture.wrapT = RepeatWrapping;
					phongMat.alphaMap = maskTexture;

					// Notify three.js that this material has been updated (to re-render it)
					phongMat.needsUpdate = true;

				}, function error( e ) {

					throw e;

				} ) );

			} else if ( maskExtension != 'zip' ) {

				loadingPromises.push( new Promise ( ( resolveMask, rejectMask ) => {

					let bmpPath = folder + '/' + rwxMaterial.mask + '.' + maskExtension;
					loader.load( bmpPath, ( maskTexture ) => {

						maskTexture.wrapS = RepeatWrapping;
						maskTexture.wrapT = RepeatWrapping;
						phongMat.alphaMap = maskTexture;
						phongMat.needsUpdate = true;
						resolveMask( texture );

					} );

				} ) );

			}

		}

	}

	return {
		phongMat: phongMat,
		loadingPromises: loadingPromises,
	};

}

function resetGeometry( ctx ) {

	if ( ctx.currentBufferFaceCount > 0 ) {

		commitBufferGeometryGroup( ctx );

	}

	ctx.currentBufferGeometry = new BufferGeometry();
	ctx.currentBufferVertices = [];
	ctx.currentBufferUVs = [];
	ctx.currentBufferFaces = [];

	ctx.currentBufferFaceCount = 0;
	ctx.currentBufferGroupFirstFaceID = 0;

	ctx.previousMaterialID = null;

}

function makeMeshToCurrentGroup( ctx ) {

	if ( ctx.currentBufferFaceCount > 0 ) {

		commitBufferGeometryGroup( ctx );

	}

	if ( ctx.currentBufferFaces.length > 0 ) {

		ctx.currentBufferGeometry.setAttribute( 'position', new BufferAttribute( new Float32Array( ctx.currentBufferVertices ), 3 ) );
		ctx.currentBufferGeometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( ctx.currentBufferUVs ), 2 ) );
		ctx.currentBufferGeometry.setIndex( ctx.currentBufferFaces );

		ctx.currentBufferGeometry.uvsNeedUpdate = true;
		ctx.currentBufferGeometry.computeVertexNormals();

		ctx.loadingPromises = ctx.loadingPromises.concat( ctx.materialManager.getCurrentMaterialList().map( res => res.loadingPromises ) );

		const mesh = new Mesh( ctx.currentBufferGeometry, ctx.materialManager.getCurrentMaterialList().map( res => res.phongMat ) );
		ctx.currentGroup.add( mesh );

	}

}

function commitBufferGeometryGroup( ctx ) {

	// Make new material group out of existing data
	ctx.currentBufferGeometry.addGroup( ctx.currentBufferGroupFirstFaceID, ctx.currentBufferFaceCount * 3, ctx.previousMaterialID );

	// Set everything ready for the next group to start
	ctx.previousMaterialID = ctx.materialManager.getCurrentMaterialID();
	ctx.currentBufferGroupFirstFaceID = ctx.currentBufferGroupFirstFaceID + ctx.currentBufferFaceCount * 3;
	ctx.currentBufferFaceCount = 0;

}

function addTriangle( ctx, a, b, c ) {

	if ( ctx.materialManager.getCurrentMaterialID() !== ctx.previousMaterialID ) {

		commitBufferGeometryGroup( ctx );

	}

	// Add new face
	ctx.currentBufferFaceCount ++;
	ctx.currentBufferFaces.push( a, b, c );

}

function addQuad( ctx, a, b, c, d ) {

	if ( ctx.materialManager.getCurrentMaterialID() !== ctx.previousMaterialID ) {

		commitBufferGeometryGroup( ctx );

	}

	if ( true && ctx.materialManager.currentRWXMaterial.geometrysampling == GeometrySampling.WIREFRAME ) {

		// We need to use a whole different geometry logic to handle wireframe quads the way the AW client does:
		// by only rendering the outter edges
		const tmpBufferGeometry = new BufferGeometry();

	  tmpBufferGeometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [

			ctx.currentBufferVertices[ a * 3 ], ctx.currentBufferVertices[ a * 3 + 1 ], ctx.currentBufferVertices[ a * 3 + 2 ],
			ctx.currentBufferVertices[ b * 3 ], ctx.currentBufferVertices[ b * 3 + 1 ], ctx.currentBufferVertices[ b * 3 + 2 ],
			ctx.currentBufferVertices[ c * 3 ], ctx.currentBufferVertices[ c * 3 + 1 ], ctx.currentBufferVertices[ c * 3 + 2 ],
			ctx.currentBufferVertices[ a * 3 ], ctx.currentBufferVertices[ a * 3 + 1 ], ctx.currentBufferVertices[ a * 3 + 2 ],
			ctx.currentBufferVertices[ c * 3 ], ctx.currentBufferVertices[ c * 3 + 1 ], ctx.currentBufferVertices[ c * 3 + 2 ],
			ctx.currentBufferVertices[ d * 3 ], ctx.currentBufferVertices[ d * 3 + 1 ], ctx.currentBufferVertices[ d * 3 + 2 ]

		] ), 3 ) );

		tmpBufferGeometry.computeVertexNormals();

		const lines = new LineSegments( new EdgesGeometry( tmpBufferGeometry ),
			new LineBasicMaterial( { color: ctx.materialManager.currentRWXMaterial.getColorHexValue() } ) );

		ctx.currentGroup.add( lines );

	} else {

		// Add two new faces
		ctx.currentBufferFaceCount += 2;
		ctx.currentBufferFaces.push( a, b, c );
		ctx.currentBufferFaces.push( a, c, d );

	}

}

function addPolygon( ctx, indices ) {

	if ( ctx.materialManager.getCurrentMaterialID() !== ctx.previousMaterialID ) {

		commitBufferGeometryGroup( ctx );

	}

	const [ newVertices, newUVs, newFaces ] =
		triangulateFacesWithShapes( ctx.currentBufferVertices, ctx.currentBufferUVs, indices );

	ctx.currentBufferVertices.push( ...newVertices );
	ctx.currentBufferUVs.push( ...newUVs );

	for ( let lf = 0; lf < newFaces.length; lf += 3 ) {

		const a = newFaces[ lf ];
		const b = newFaces[ lf + 1 ];
		const c = newFaces[ lf + 2 ];

		// Add new face
		ctx.currentBufferFaceCount ++;
		ctx.currentBufferFaces.push( a, b, c );

	}

}

function pushCurrentGroup( ctx ) {

	let group = new Group();
	ctx.currentGroup.add( group );
	ctx.groupStack.push( ctx.currentGroup );
	ctx.currentGroup = group;

}

function popCurrentGroup( ctx ) {

	ctx.currentGroup = ctx.groupStack.pop();

}

function pushCurrentTransform( ctx ) {

	ctx.transformStack.push( ctx.currentTransform );
	ctx.currentTransform = new Matrix4();

}

function popCurrentTransform( ctx ) {

	ctx.currentTransform = ctx.transformStack.pop();

}

function saveCurrentTransform( ctx ) {

	ctx.transformSaves.push( ctx.currentTransform.clone() );

}

function loadCurrentTransform( ctx ) {

	if ( ctx.transformSaves.length > 0 ) {

		ctx.currentTransform = ctx.transformSaves.pop();

	} else {

		ctx.currentTransform = new Matrix4();

	}

}

// Utility function to merge all group and subgroup geometries into on single buffer, all while taking materials into account
function mergeGeometryRecursive( group, ctx, transform = group.matrix ) {

	group.children.forEach( ( child ) => {

		let localTransform = new Matrix4();
		localTransform.copy( transform );
		localTransform.multiply( child.matrix );

		if ( child instanceof Mesh ) {

			// We first need to set up the new BufferGeometry groups
			let geometryGroups = [];

			child.geometry.groups.forEach( ( g ) => {

				// Each group in the original geometry from the child needs to be exported,
				// we take into account the already-registered geometry and materials
				// from the context, so that we can compute offsets and match the
				// final layout of the mesh (and final material IDs as well)
				geometryGroups.push( {

					start: g.start + ctx.indices.length,
					count: g.count,
					materialIndex: g.materialIndex + ctx.materials.length

				} );

			} );

			const originalVertices = child.geometry.getAttribute( 'position' ).array;
			const faceOffset = ctx.positions.length / 3;

			// Import the current geometry (vertices and faces) from the child into the final buffer,
			// apply local transformations if any
			for ( let i = 0, l = originalVertices.length / 3; i < l; i ++ ) {

				let tmpVertex = new Vector4( originalVertices[ i * 3 ], originalVertices[ i * 3 + 1 ], originalVertices[ i * 3 + 2 ] );
				tmpVertex.applyMatrix4( localTransform );

				ctx.positions.push( tmpVertex.x );
				ctx.positions.push( tmpVertex.y );
				ctx.positions.push( tmpVertex.z );

			}

			// Do not forget the UVs either
			ctx.uvs.push( ...child.geometry.getAttribute( 'uv' ).array );

			ctx.indices.push( ...child.geometry.getIndex().array.map( ( value ) => {

				return value + faceOffset;

			} ) );

			// Add the materials from the child to the final material list
			ctx.materials.push( ...child.material );

			// Since the new BufferGeometry groups are all set, we can import them into the
			// final buffer geometry
			geometryGroups.forEach( ( g ) => {

				ctx.bufferGeometry.addGroup( g.start, g.count, g.materialIndex );

			} );

		} else if ( child instanceof Group ) {

			/* Recursive case */
			mergeGeometryRecursive( child, ctx, localTransform );

		}

	} );

}

function flattenGroup( group ) {

	let ctx = {

		bufferGeometry: new BufferGeometry(),
		positions: [],
		uvs: [],
		indices: [],
		materials: [],

	};

	mergeGeometryRecursive( group, ctx );

	/* Ready data for final BufferGeometry */
	ctx.bufferGeometry.setAttribute( 'position', new BufferAttribute( new Float32Array( ctx.positions ), 3 ) );
	ctx.bufferGeometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( ctx.uvs ), 2 ) );
	ctx.bufferGeometry.setIndex( ctx.indices );
	ctx.uvsNeedUpdate = true;
	ctx.bufferGeometry.computeVertexNormals();

	let finalMesh = new Mesh( ctx.bufferGeometry, ctx.materials );

	finalMesh.userData[ 'rwx' ] = group.userData[ 'rwx' ];

	return finalMesh;

}

class RWXMaterial {

	// Material related properties start here
	color = [ 0.0, 0.0, 0.0 ]; // Red, Green, Blue
	surface = [ 0.0, 0.0, 0.0 ]; // Ambience, Diffusion, Specularity
	opacity = 1.0;
	lightsampling = LightSampling.FACET;
	geometrysampling = GeometrySampling.SOLID;
	texturemodes = [ TextureMode
		.LIT,
	]; // There's possibly more than one mode enabled at a time (hence why we use an array)
	materialmode = MaterialMode.NULL; // Neither NONE nor DOUBLE: we only render one side of the polygon
	texture = null;
	mask = null;
	collision = true;
	// End of material related properties

	transform = new Matrix4();

	constructor() {

	}

	getColorHexValue() {

		return ( Math.trunc( this.color[ 0 ] * 255 ) << 16 ) + ( Math.trunc( this
			.color[ 1 ] * 255 ) << 8 ) + Math.trunc( this.color[ 2 ] * 255 );

	}

	getMatSignature() {

		let sign = this.color[ 0 ].toFixed( 3 ) + this.color[ 1 ].toFixed( 3 ) + this.color[ 2 ].toFixed( 3 );
		sign += this.surface[ 0 ].toFixed( 3 ) + this.surface[ 1 ].toFixed( 3 ) + this.surface[ 2 ].toFixed( 3 );
		sign += this.opacity.toFixed( 3 );
		sign += this.lightsampling.toString() + this.geometrysampling.toString();
		this.texturemodes.forEach( ( tm ) => {

			sign += tm.toString();

		} );

		sign += this.materialmode.toString();

		if ( this.texture != null ) {

			sign += this.texture;

		}

		if ( this.mask != null ) {

			sign += this.mask;

		}

		sign += this.collision.toString();

		return sign;

	}

}

class RWXMaterialManager {

	folder
	texExtension
	maskExtension
	jsZip
	jsZipUtils

	currentRWXMaterial = new RWXMaterial();
	threeMaterialMap = {};
	currentMaterialID = null;
	currentMaterialList = [];
	currentMaterialSignature = "";

	constructor( folder, texExtension = "jpg", maskExtension =
	  "zip", jsZip = null, jsZipUtils = null ) {

		this.folder = folder;
		this.texExtension = texExtension;
		this.maskExtension = maskExtension;
		this.jsZip = jsZip;
		this.jsZipUtils = jsZipUtils;
	}

	getCurrentMaterialID() {

		const materialSignature = this.currentRWXMaterial.getMatSignature();

		// This gets called when the material is actually required by (at least) one face,
		// meaning we need to save the material in the map if it's not already done
		if ( this.threeMaterialMap[ materialSignature ] === undefined ) {

			this.threeMaterialMap[ materialSignature ] = makeThreeMaterial( this.currentRWXMaterial,
				this.folder, this.texExtension, this.maskExtension, this.jsZip, this.jsZipUtils );
			this.threeMaterialMap[ materialSignature ].needsUpdate = true;

		}

		if ( this.currentMaterialSignature != materialSignature ) {

			this.currentMaterialSignature = materialSignature;

			// We're onto a new material given the current list, we need to add it to the list and increment the ID
			if ( this.currentMaterialID === null ) {

				this.currentMaterialID = 0;

			} else {

				this.currentMaterialID ++;

			}

			this.currentMaterialList.push( this.threeMaterialMap[ materialSignature ] );

		}

		return this.currentMaterialID;

	}

	getCurrentMaterial() {

		  return this.currentMaterialList[ this.getCurrentMaterialID() ];

	}

	getCurrentMaterialList() {

		return this.currentMaterialList;

	}

	resetCurrentMaterialList() {

		this.currentMaterialID = null;
		this.currentMaterialList = [];
		this.currentMaterialSignature = "";
		this.currentRWXMaterial = new RWXMaterial();

	}

}

class RWXLoader extends Loader {

	integerRegex = /([-+]?[0-9]+)/g;
	floatRegex = /([+-]?([0-9]+([.][0-9]*)?|[.][0-9]+))/g;
	nonCommentRegex = /^(.*)#/g;
	modelbeginRegex = /^ *(modelbegin).*$/i;
	modelendRegex = /^ *(modelend).*$/i;
	clumpbeginRegex = /^ *(clumpbegin).*$/i;
	clumpendRegex = /^ *(clumpend).*$/i;
	transformbeginRegex = /^ *(transformbegin).*$/i;
	transformendRegex = /^ *(transformend).*$/i;
	protobeginRegex = /^ *(protobegin) +([A-Za-z0-9_\-]+).*$/i;
	protoinstanceRegex = /^ *(protoinstance) +([A-Za-z0-9_\-]+).*$/i;
	protoendRegex = /^ *(protoend).*$/i;
	vertexRegex = /^ *(vertex|vertexext)(( +[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)){3}) *(uv(( +[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)){2}))?.*$/i;
	polygonRegex = /^ *(polygon|polygonext)( +[0-9]+)(( +[0-9]+)+) ?.*$/i;
	quadRegex = /^ *(quad|quadext)(( +([0-9]+)){4}).*$/i;
	triangleRegex = /^ *(triangle|triangleext)(( +([0-9]+)){3}).*$/i;
	textureRegex = /^ *(texture) +([A-Za-z0-9_\-]+) *(mask *([A-Za-z0-9_\-]+))?.*$/i;
	colorRegex = /^ *(color)(( +[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)){3}).*$/i;
	opacityRegex = /^ *(opacity)( +[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)).*$/i;
	identityRegex = /^ *(identity) *$/i;
	transformRegex = /^ *(transform)(( +[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)){16}).*$/i;
	translateRegex = /^ *(translate)(( +[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)){3}).*$/i;
	scaleRegex = /^ *(scale)(( +[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)){3}).*$/i;
	rotateRegex = /^ *(rotate)(( +[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)){4})$/i;
	surfaceRegex = /^ *(surface)(( +[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)){3}).*$/i;
	ambientRegex = /^ *(ambient)( +[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)).*$/i;
	diffuseRegex = /^ *(diffuse)( +[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)).*$/i;
	specularRegex = /^ *(specular)( +[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)).*$/i;
	materialModeRegex = /^ *((add)?materialmode(s)?) +([A-Za-z0-9_\-]+).*$/i;
	collisionRegex = /^ *(collision) +(on|off).*$/i;
	lightsamplingRegex = /^ *(lightsampling) +(facet|vertex).*$/i;
	geometrysamplingRegex = /^ *(geometrysampling) +(pointcloud|wireframe|solid).*$/i;
	axisalignmentRegex = /^ *(axisalignment) +(none|zorientx|zorienty|xyz).*$/i;

	jsZip = null;
	jsZipUtils = null;
	texExtension = 'jpg';
	maskExtension = 'zip';

	waitFullLoad = false;
	flatten = false;

	constructor( manager ) {

		super( manager );

	}

	// Provide jsZip and jsZipUtils modules to the loader, required for proper texture masks handling
	setJSZip( jsZip, jsZipUtils ) {

		this.jsZip = jsZip;
		this.jsZipUtils = jsZipUtils;

		return this;

	}

	// Set the expected texture files extension, 'jpg' by default
	setTexExtension( texExtension ) {

		this.texExtension = texExtension;

		return this;

	}

	// Set the expected texture mask files extension, 'zip' by default
	setMaskExtension( maskExtension ) {

		this.maskExtension = maskExtension;

		return this;

	}

	// Wether or not to wait for full loading before returning the objet, textures are loaded asynchronously by default,
	// set this to 'true' for the loader to only return the object once it's fully loaded
	setWaitFullLoad ( waitFullLoad ) {

		this.waitFullLoad = waitFullLoad;

		return this;

	}

	// Wether or not to flatten the objet, the object will consist of nested groups by default,
	// set this to 'true' to get a single mesh holding everything
	setFlatten ( flatten ) {

		this.flatten = flatten;

		return this;

	}

	load( rwxFile, onLoad, onProgress, onError ) {

		let scope = this;
		let path = this.path;
		let resourcePath = this.resourcePath;

		let loader = new FileLoader( this.manager );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );
		loader.load( path + "/" + rwxFile, function ( text ) {

			try {

				scope.parse ( text, resourcePath, function ( loadedObject ) {

					onLoad( loadedObject );

				});

			} catch ( e ) {

				if ( onError ) {

					onError( e );

				} else {

					console.error( e );

				}

				scope.manager.itemError( rwxFile );

			}

		}, onProgress, onError );

	}

	parse( str, textureFolderPath, onParse ) {

		// Parsing RWX file content

		let ctx = {

			groupStack: [],
			currentGroup: null,

			transformStack: [],
			transformSaves: [],

			currentTransform: new Matrix4(),
			currentBufferGeometry: null,
			currentBufferVertices: [],
			currentBufferUVs: [],
			currentBufferFaces: [],

			currentBufferFaceCount: 0,
			currentBufferGroupFirstFaceID: 0,

			previousMaterialID: null,

			rwxClumpStack: [],
			rwxProtoDict: {},

			loadingPromises: [],

			materialManager: new RWXMaterialManager( textureFolderPath, this.texExtension, this.maskExtension, this.jsZip, this.jsZipUtils )

		};

		let transformBeforeProto = null;
		let groupBeforeProto = null;

		const scale_ten = new Matrix4();
		scale_ten.makeScale( 10.0, 10.0, 10.0 );

		const lines = str.split( /[\n\r]+/g );

		for ( let i = 0, l = lines.length; i < l; i ++ ) {

			let line = lines[ i ];

			// strip comment away (if any)
			let res = this.nonCommentRegex.exec( line );
			if ( res != null ) {

				line = res[ 1 ];

			}

			// replace tabs with spaces
			line = line.trim().replace( /\t/g, ' ' );

			res = this.modelbeginRegex.exec( line );
			if ( res != null ) {

				ctx.groupStack.push( new Group() );
				ctx.groupStack[ 0 ].userData[ 'rwx' ] = { axisAlignment: "none" };
				ctx.currentGroup = ctx.groupStack.slice( - 1 )[ 0 ];

				ctx.transformStack.push( ctx.currentTransform );

				continue;

			}

			res = this.clumpbeginRegex.exec( line );
			if ( res != null ) {

				makeMeshToCurrentGroup( ctx );
				resetGeometry( ctx );

				pushCurrentGroup( ctx );
				pushCurrentTransform( ctx );

				continue;

			}

			res = this.clumpendRegex.exec( line );
			if ( res != null ) {

				makeMeshToCurrentGroup( ctx );

				popCurrentTransform( ctx );
				popCurrentGroup( ctx );

				resetGeometry( ctx );

				ctx.materialManager.resetCurrentMaterialList();

				continue;

			}

			res = this.transformbeginRegex.exec( line );
			if ( res != null ) {

				saveCurrentTransform( ctx );

				continue;

			}

			res = this.transformendRegex.exec( line );
			if ( res != null ) {

				loadCurrentTransform( ctx );

				continue;

			}

			res = this.protobeginRegex.exec( line );
			if ( res != null ) {

				let name = res[ 2 ];

				transformBeforeProto = ctx.currentGroup;
				groupBeforeProto = ctx.currentTransform;

				ctx.rwxProtoDict[ name ] = new Group();
				ctx.currentTransform = new Matrix4();

				resetGeometry( ctx );

				ctx.materialManager.currentRWXMaterial = new RWXMaterial();
				ctx.currentGroup = ctx.rwxProtoDict[ name ];

				continue;

			}

			res = this.protoendRegex.exec( line );
			if ( res != null ) {

				makeMeshToCurrentGroup( ctx );

				ctx.currentGroup = transformBeforeProto;
				ctx.currentTransform = groupBeforeProto;

				resetGeometry( ctx );

				ctx.materialManager.resetCurrentMaterialList();

				continue;

			}

			res = this.protoinstanceRegex.exec( line );
			if ( res != null ) {

				let name = res[ 2 ];
				let protoMesh = ctx.rwxProtoDict[ name ].clone();
				let tmpTransform = getFinalTransform( ctx );
				protoMesh.applyMatrix4( tmpTransform );
				ctx.currentGroup.add( protoMesh );

				continue;

			}

			res = this.textureRegex.exec( line );
			if ( res != null ) {

				if ( res[ 2 ].toLowerCase() == "null" ) {

					ctx.materialManager.currentRWXMaterial.texture = null;

				} else {

					ctx.materialManager.currentRWXMaterial.texture = res[ 2 ];

				}

				if ( res[ 4 ] !== undefined ) {

					ctx.materialManager.currentRWXMaterial.mask = res[ 4 ];

				} else {

					ctx.materialManager.currentRWXMaterial.mask = null;

				}

				continue;

			}

			res = this.triangleRegex.exec( line );
			if ( res != null ) {

				let vId = [];
				res[ 2 ].match( this.integerRegex ).forEach( ( entry ) => {

					vId.push( parseInt( entry ) - 1 );

				} );

				addTriangle( ctx, vId[ 0 ], vId[ 1 ], vId[ 2 ] );

				continue;

			}

			res = this.quadRegex.exec( line );
			if ( res != null ) {

				let vId = [];
				res[ 2 ].match( this.integerRegex ).forEach( ( entry ) => {

					vId.push( parseInt( entry ) - 1 );

				} );

				addQuad( ctx, vId[ 0 ], vId[ 1 ], vId[ 2 ], vId[ 3 ] );

				continue;

			}

			res = this.polygonRegex.exec( line );
			if ( res != null ) {

				const polyLen = parseInt( res[ 2 ].match( this.integerRegex )[ 0 ] );
				let polyIDs = [];
				const polyStrIDs = res[ 3 ].match( this.integerRegex );

				for ( let polyI = 0; polyI < polyLen; polyI ++ ) {

					const id = polyStrIDs[ polyI ];
					polyIDs.unshift( parseInt( id ) - 1 );

				}

				addPolygon( ctx, polyIDs );

				continue;

			}

			res = this.vertexRegex.exec( line );
			if ( res != null ) {

				let vprops = [];
				res[ 2 ].match( this.floatRegex ).forEach( ( x ) => {

					vprops.push( parseFloat( x ) );

				} );

				let tmpVertex = new Vector4( vprops[ 0 ], vprops[ 1 ], vprops[ 2 ] );
				tmpVertex.applyMatrix4( getFinalTransform( ctx ) );

				ctx.currentBufferVertices.push( tmpVertex.x, tmpVertex.y, tmpVertex.z );

				if ( typeof ( res[ 7 ] ) != "undefined" ) {

					let moreVprops = [];
					res[ 7 ].match( this.floatRegex ).forEach( ( x ) => {

						moreVprops.push( parseFloat( x ) );

					} );

					ctx.currentBufferUVs.push( moreVprops[ 0 ], 1 - moreVprops[ 1 ] );

				} else {

					ctx.currentBufferUVs.push( 0.0, 0.0 );

				}

				continue;

			}

			res = this.colorRegex.exec( line );
			if ( res != null ) {

				let cprops = [];
				res[ 2 ].match( this.floatRegex ).forEach( ( x ) => {

					cprops.push( parseFloat( x ) );

				} );

				if ( cprops.length == 3 ) {

					ctx.materialManager.currentRWXMaterial.color = cprops;

				}

				continue;

			}

			res = this.opacityRegex.exec( line );
			if ( res != null ) {

				ctx.materialManager.currentRWXMaterial.opacity = parseFloat( res[ 2 ] );
				continue;

			}

			res = this.identityRegex.exec( line );
			if ( res != null ) {

				ctx.currentTransform.identity();

			}

			res = this.transformRegex.exec( line );
			if ( res != null ) {

				let tprops = [];
				res[ 2 ].match( this.floatRegex ).forEach( ( x ) => {

					tprops.push( parseFloat( x ) );

				} );

				if ( tprops.length == 16 ) {

					// Important Note: it seems the AW client always acts as if this element (which is related to the projection plane)
					// was equal to 1 when it was set 0, hence why we always override this.
					if ( tprops[ 15 ] == 0.0 ) {

						tprops[ 15 ] = 1;

					}

					ctx.currentTransform.fromArray( tprops );

				}

				continue;

			}

			res = this.translateRegex.exec( line );
			if ( res != null ) {

				let tprops = [];
				res[ 2 ].match( this.floatRegex ).forEach( ( x ) => {

					tprops.push( parseFloat( x ) );

				} );

				let translateM = new Matrix4();

				if ( tprops.length == 3 ) {

					translateM.makeTranslation( tprops[ 0 ], tprops[ 1 ], tprops[ 2 ] );
					ctx.currentTransform.multiply( translateM );

				}

				continue;

			}

			res = this.rotateRegex.exec( line );
			if ( res != null ) {

				let rprops = [];
				res[ 2 ].match( this.floatRegex ).forEach( ( x ) => {

					rprops.push( parseFloat( x ) );

				} );

				if ( rprops.length == 4 ) {

					let rotateM = new Matrix4();

					if ( rprops[ 0 ] ) {

						rotateM.makeRotationX( MathUtils.degToRad( rprops[ 0 ] * rprops[ 3 ] ) );
						ctx.currentTransform.multiply( rotateM );

					}

					if ( rprops[ 1 ] ) {

						rotateM.makeRotationY( MathUtils.degToRad( rprops[ 1 ] * rprops[ 3 ] ) );
						ctx.currentTransform.multiply( rotateM );

					}

					if ( rprops[ 2 ] ) {

						rotateM.makeRotationZ( MathUtils.degToRad( rprops[ 2 ] * rprops[ 3 ] ) );
						ctx.currentTransform.multiply( rotateM );

					}

				}

				continue;

			}

			res = this.scaleRegex.exec( line );
			if ( res != null ) {

				let sprops = [];
				res[ 2 ].match( this.floatRegex ).forEach( ( x ) => {

					sprops.push( parseFloat( x ) );

				} );

				let scaleM = new Matrix4();

				if ( sprops.length == 3 ) {

					scaleM.makeScale( sprops[ 0 ], sprops[ 1 ], sprops[ 2 ] );
					ctx.currentTransform.multiply( scaleM );

				}

				continue;

			}

			res = this.surfaceRegex.exec( line );
			if ( res != null ) {

				let sprops = [];
				res[ 2 ].match( this.floatRegex ).forEach( ( x ) => {

					sprops.push( parseFloat( x ) );

				} );

				ctx.materialManager.currentRWXMaterial.surface = sprops;
				continue;

			}

			res = this.ambientRegex.exec( line );
			if ( res != null ) {

				ctx.materialManager.currentRWXMaterial.surface[ 0 ] = parseFloat( res[ 2 ] );
				continue;

			}

			res = this.diffuseRegex.exec( line );
			if ( res != null ) {

				ctx.materialManager.currentRWXMaterial.surface[ 1 ] = parseFloat( res[ 2 ] );
				continue;

			}

			res = this.specularRegex.exec( line );
			if ( res != null ) {

				ctx.materialManager.currentRWXMaterial.surface[ 2 ] = parseFloat( res[ 2 ] );
				continue;

			}

			res = this.materialModeRegex.exec( line );
			if ( res != null ) {

				const matMode = res[ 4 ].toLowerCase();

				if ( matMode == "none" ) {

					ctx.materialManager.currentRWXMaterial.materialmode = MaterialMode.NONE;

				} else if ( matMode == "null" ) {

					ctx.materialManager.currentRWXMaterial.materialmode = MaterialMode.NULL;

				} else if ( matMode == "double" ) {

					ctx.materialManager.currentRWXMaterial.materialmode = MaterialMode.DOUBLE;

				}

				continue;

			}

			res = this.collisionRegex.exec( line );
			if ( res != null ) {

				const collision = res[ 2 ].toLowerCase();

				if ( collision == "on" ) {

					ctx.materialManager.currentRWXMaterial.collision = true;

				} else if ( collision == "off" ) {

					ctx.materialManager.currentRWXMaterial.collision = false;

				}

				continue;

			}

			res = this.lightsamplingRegex.exec( line );
			if ( res != null ) {

				const ls = res[ 2 ].toLowerCase();

				if ( ls == "vertex" ) {

					ctx.materialManager.currentRWXMaterial.lightsampling = LightSampling.VERTEX;

				} else {

					ctx.materialManager.currentRWXMaterial.lightsampling = LightSampling.FACET;

				}

				continue;

			}

			res = this.geometrysamplingRegex.exec( line );
			if ( res != null ) {

				const gs = res[ 2 ].toLowerCase();

				if ( gs == "pointcloud" ) {

					ctx.materialManager.currentRWXMaterial.geometrysampling = GeometrySampling.POINTCLOUD;

				} else if ( gs == "wireframe" ) {

					ctx.materialManager.currentRWXMaterial.geometrysampling = GeometrySampling.WIREFRAME;

				} else {

					ctx.materialManager.currentRWXMaterial.geometrysampling = GeometrySampling.SOLID;

				}

				continue;

			}

			res = this.axisalignmentRegex.exec( line );
			if ( res != null ) {

				ctx.groupStack[ 0 ].userData.rwx.axisAlignment = res[ 2 ].toLowerCase();

				continue;

			}

		}

		// We're done, return the root group to get the whole object, we take the decameter unit into account
		ctx.groupStack[ 0 ].applyMatrix4( scale_ten );

		if ( this.waitFullLoad ) {

			// Wait all mask futures before returning loaded object
			Promise.all( ctx.loadingPromises.flat() ).then( ( results ) => {

				onParse( this.flatten ? flattenGroup( ctx.groupStack[ 0 ] ) : ctx.groupStack[ 0 ] );

			});

		} else {

			// Return immediately
			onParse( this.flatten ? flattenGroup( ctx.groupStack[ 0 ] ) : ctx.groupStack[ 0 ] );

		}

	}

}

export default RWXLoader;
