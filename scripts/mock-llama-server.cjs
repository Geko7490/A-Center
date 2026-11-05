const http=require('node:http');
const port=Number(process.argv[process.argv.indexOf('--port')+1]);
let ready=false,previous='',hits=0;
setTimeout(()=>{ready=true;process.stderr.write('load_tensors: offloaded 24/25 layers to GPU\n');},150);
http.createServer(async(req,res)=>{
 if(req.url==='/health'){res.writeHead(ready?200:503);res.end('{}');return;}
 if(req.headers.authorization!==`Bearer ${process.env.LLAMA_API_KEY}`){res.writeHead(401);res.end();return;}
 let body='';for await(const c of req)body+=c;const b=JSON.parse(body);hits++;
 if(req.url==='/apply-template'){res.setHeader('content-type','application/json');res.end(JSON.stringify({prompt:'fixture prompt'}));return;}
 if(req.url==='/tokenize'){res.setHeader('content-type','application/json');res.end(JSON.stringify({tokens:Array(700).fill(1)}));return;}
 if(Number(process.argv[process.argv.indexOf('-c')+1])===1024&&b.max_tokens>292){res.writeHead(400);res.end(JSON.stringify({error:{message:'Output budget exceeds context'}}));return;}
 if(!b.cache_prompt||b.id_slot!==0){res.writeHead(400);res.end();return;}
 const prefix=JSON.stringify(b.messages);const cached=previous===prefix?120:0;previous=prefix;
 res.writeHead(200,{'content-type':'text/event-stream'});
 const timer=setTimeout(()=>{res.write('data: '+JSON.stringify({choices:[{delta:{content:'A'.repeat(800)}}]})+'\n\n');res.end('data: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{completion_tokens:4},timings:{cache_n:cached,prompt_n:cached?1:121,prompt_ms:cached?5:100,prompt_per_second:cached?200:1210,predicted_n:4,predicted_ms:50,predicted_per_second:80}})+'\n\ndata: [DONE]\n\n');},b.messages.at(-1).content==='slow'?10000:40);
 res.on('close',()=>clearTimeout(timer));
}).listen(port,'127.0.0.1');
