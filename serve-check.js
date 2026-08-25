const path=require('path'),express=require('express'),app=express();
app.get('/', (q,r)=>r.sendFile(path.join(__dirname,'public','index.html')));
app.get('/favicon.svg',(q,r)=>r.sendFile(path.join(__dirname,'public','favicon.svg')));
const s=app.listen(4321,()=>console.log('up'));setTimeout(()=>{s.close();},60000);
