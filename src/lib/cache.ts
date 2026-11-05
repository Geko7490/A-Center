// Cache in-flight work as well as its result; failed probes expire quickly.
export class ProbeCache<T> {
  private entries = new Map<string,{until:number;promise:Promise<T>}>();
  constructor(private ttl=600000,private failedTtl=3000) {}
  get(key:string,work:()=>Promise<T>,force=false):Promise<T>{
    const previous=this.entries.get(key);
    if(!force&&previous&&previous.until>Date.now())return previous.promise;
    const entry={until:Infinity,promise:Promise.resolve().then(work)};
    this.entries.set(key,entry);
    void entry.promise.then(()=>{entry.until=Date.now()+this.ttl;},()=>{entry.until=Date.now()+this.failedTtl;});
    return entry.promise;
  }
  clear(){this.entries.clear();}
}
