import {mkdir,writeFile} from 'node:fs/promises';
import {BlobWriter,BlobReader,ZipWriter} from '@zip.js/zip.js';
import {encodeMp3Set} from '../src/features/local/audio/mp3';
import {MP3_NAMES} from '../src/features/local/audio/mp3Types';
import {digest,type Bundle} from '../src/features/local/transfer/manifest';
const dir=process.argv[2];if(!dir)throw new Error('Output folder required');await mkdir(dir,{recursive:true});
const signal={left:new Float32Array(44100*4),right:new Float32Array(44100*4),sampleRate:44100};
const mp3=await encodeMp3Set(signal,{drums:signal,bass:signal,other:signal,vocals:signal});
const collection={path:'album/5555555555555555555555',title:'Playlist transfer check',artwork:'',trackIds:['transferFixtureOne','transferFixtureTwo']};
const writer=new ZipWriter(new BlobWriter(),{level:0,useWebWorkers:false});
const bundle:Bundle={format:'ktv420-playlist',version:1,collection,tracks:[]};
for(const [i,id] of collection.trackIds.entries()){
 const files={} as Bundle['tracks'][number]['files'];await mkdir(`${dir}/folder/tracks/${id}`,{recursive:true});
 for(const name of MP3_NAMES){const blob=mp3.files[name],path=`tracks/${id}/${name}.mp3`;files[name]={path,bytes:blob.size,sha256:await digest(blob)};await writer.add(path,new BlobReader(blob));await writeFile(`${dir}/folder/${path}`,new Uint8Array(await blob.arrayBuffer()));}
 bundle.tracks.push({id,title:i?'Second song':'First song',artist:'Synthetic audio',frames:signal.left.length,sampleRate:44100,encoding:mp3.encoding,crop:'0-0',artworkUrl:'',files});
}
const manifest=JSON.stringify(bundle);await writer.add('ktv420.json',new BlobReader(new Blob([manifest])));await writeFile(`${dir}/folder/ktv420.json`,manifest);
const zip=await writer.close();await writeFile(`${dir}/playlist.zip`,new Uint8Array(await zip.arrayBuffer()));console.log(`${dir}/playlist.zip`);
