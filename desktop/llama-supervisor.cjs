// The pipe belongs to the Next backend. EOF also occurs if that parent crashes
// or is terminated by Electron, so the model process cannot survive the app.
const {spawn}=require('node:child_process');
const child=spawn(process.argv[2],process.argv.slice(3),{windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
process.stdout.write(`A_CENTER_WORKER_PID=${child.pid}\n`);
let stopping=false;
function stop(){if(!stopping){stopping=true;child.kill();}}
process.stdin.resume();process.stdin.on('end',stop);process.stdin.on('close',stop);
process.on('SIGTERM',stop);process.on('SIGINT',stop);
process.stdout.on('error',stop);process.stderr.on('error',stop);
child.once('error',()=>process.exit(1));child.once('exit',code=>process.exit(code||0));
