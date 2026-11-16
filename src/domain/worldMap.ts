export interface WorldMapNode { id:string; name:string; x:number; y:number; region:1|2|3|4; neighbors:string[] }

const raw:Array<Omit<WorldMapNode,"neighbors">>=[
  {id:"home",name:"본거지",x:21.0,y:73.0,region:1},{id:"southwest",name:"서남 거점",x:14.0,y:81.2,region:1},
  {id:"south",name:"남부 거점",x:22.4,y:84.1,region:1},{id:"southeast",name:"동남 거점",x:29.8,y:79.8,region:1},
  {id:"west",name:"서부 거점",x:9.2,y:78.2,region:1},{id:"center",name:"중앙 거점",x:16.0,y:69.2,region:1},
  {id:"east",name:"동부 거점",x:27.8,y:69.0,region:1},{id:"northwest",name:"서북 거점",x:11.5,y:65.2,region:1},
  {id:"northeast",name:"동북 거점",x:12.5,y:57.5,region:1},{id:"island",name:"연결 거점",x:39.9,y:56.4,region:1},
  {id:"nw-01",name:"북서 1거점",x:32.9,y:50.5,region:2},{id:"nw-02",name:"북서 2거점",x:33.8,y:39.1,region:2},
  {id:"nw-03",name:"북서 3거점",x:27.2,y:34.6,region:2},{id:"nw-04",name:"북서 4거점",x:48.4,y:34.0,region:2},
  {id:"nw-05",name:"북서 5거점",x:38.4,y:32.3,region:2},{id:"nw-06",name:"북서 6거점",x:41.1,y:27.0,region:2},
  {id:"nw-07",name:"북서 7거점",x:38.3,y:21.4,region:2},{id:"nw-08",name:"북서 8거점",x:31.6,y:18.1,region:2},
  {id:"nw-09",name:"북서 9거점",x:34.2,y:12.7,region:2},{id:"nw-10",name:"북서 10거점",x:40.1,y:10.4,region:2},
  {id:"se-01",name:"남동 1거점",x:55.1,y:49.5,region:3},{id:"se-02",name:"남동 2거점",x:65.8,y:48.6,region:3},
  {id:"se-03",name:"남동 3거점",x:73.0,y:63.1,region:3},{id:"se-04",name:"남동 4거점",x:79.2,y:71.6,region:3},
  {id:"se-05",name:"남동 5거점",x:72.8,y:80.9,region:3},{id:"se-06",name:"남동 6거점",x:76.8,y:87.0,region:3},
  {id:"se-07",name:"남동 7거점",x:62.4,y:82.0,region:3},{id:"se-08",name:"남동 8거점",x:56.6,y:72.4,region:3},
  {id:"se-09",name:"남동 9거점",x:51.2,y:53.5,region:3},{id:"se-10",name:"남동 10거점",x:60.9,y:56.1,region:3},
  {id:"ne-01",name:"북동 1거점",x:68.1,y:33.3,region:4},{id:"ne-02",name:"북동 2거점",x:79.2,y:39.7,region:4},
  {id:"ne-03",name:"북동 3거점",x:91.3,y:41.9,region:4},{id:"ne-04",name:"북동 4거점",x:90.4,y:29.3,region:4},
  {id:"ne-05",name:"북동 5거점",x:89.2,y:21.6,region:4},{id:"ne-06",name:"북동 6거점",x:80.7,y:25.9,region:4},
  {id:"ne-07",name:"북동 7거점",x:72.4,y:20.3,region:4},{id:"ne-08",name:"북동 8거점",x:79.7,y:16.7,region:4},
  {id:"ne-09",name:"북동 9거점",x:78.3,y:9.6,region:4},{id:"ne-10",name:"북동 10거점",x:86.5,y:9.5,region:4},
];

const regionChains=[["west","southwest","home","south","southeast","east","center","northwest","northeast","island"],
  ["nw-01","nw-02","nw-03","nw-04","nw-05","nw-06","nw-07","nw-08","nw-09","nw-10"],
  ["se-01","se-02","se-03","se-04","se-05","se-06","se-07","se-08","se-09","se-10"],
  ["ne-01","ne-02","ne-03","ne-04","ne-05","ne-06","ne-07","ne-08","ne-09","ne-10"]];
const links=new Set<string>();
const connect=(a:string,b:string)=>links.add([a,b].sort().join("|"));
regionChains.forEach(chain=>{chain.forEach((id,index)=>{if(index)connect(chain[index-1],id);if(index>1&&index%3===0)connect(chain[index-3],id);});});
[["island","nw-01"],["island","se-01"],["nw-04","ne-01"],["se-09","ne-02"]].forEach(([a,b])=>connect(a,b));
export const worldMapNodes:WorldMapNode[]=raw.map(node=>({...node,neighbors:[...links].filter(link=>link.split("|").includes(node.id)).map(link=>link.split("|").find(id=>id!==node.id)!)}));
export const STARTING_TERRITORY_IDS=worldMapNodes.filter(node=>node.region===1).map(node=>node.id);
