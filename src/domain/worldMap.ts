export interface WorldMapNode { id:string; name:string; x:number; y:number; region:1|2|3|4; neighbors:string[] }

const raw:Array<Omit<WorldMapNode,"neighbors">>=[
  {id:"home",name:"본거지",x:22.4,y:83.8,region:1},{id:"southwest",name:"서남 거점",x:15.7,y:81.4,region:1},
  {id:"south",name:"남부 거점",x:29.6,y:79,region:1},{id:"southeast",name:"동남 거점",x:26.5,y:71.7,region:1},
  {id:"west",name:"서부 거점",x:9.5,y:77.8,region:1},{id:"center",name:"중앙 거점",x:14.4,y:73.8,region:1},
  {id:"east",name:"동부 거점",x:20.1,y:62,region:1},{id:"northwest",name:"서북 거점",x:10.3,y:67,region:1},
  {id:"northeast",name:"동북 거점",x:14.3,y:57.1,region:1},{id:"island",name:"연결 거점",x:39.8,y:55.2,region:1},
  {id:"nw-01",name:"북서 1거점",x:34,y:49.5,region:2},{id:"nw-02",name:"북서 2거점",x:39.5,y:46.5,region:2},
  {id:"nw-03",name:"북서 3거점",x:33.5,y:38.5,region:2},{id:"nw-04",name:"북서 4거점",x:45.5,y:36.5,region:2},
  {id:"nw-05",name:"북서 5거점",x:31.5,y:29,region:2},{id:"nw-06",name:"북서 6거점",x:40,y:28.5,region:2},
  {id:"nw-07",name:"북서 7거점",x:27.5,y:19.5,region:2},{id:"nw-08",name:"북서 8거점",x:38.5,y:18,region:2},
  {id:"nw-09",name:"북서 9거점",x:31.5,y:11,region:2},{id:"nw-10",name:"북서 10거점",x:43,y:13.5,region:2},
  {id:"se-01",name:"남동 1거점",x:54,y:64,region:3},{id:"se-02",name:"남동 2거점",x:64.5,y:66,region:3},
  {id:"se-03",name:"남동 3거점",x:73.5,y:70.5,region:3},{id:"se-04",name:"남동 4거점",x:65,y:75,region:3},
  {id:"se-05",name:"남동 5거점",x:76.5,y:79.5,region:3},{id:"se-06",name:"남동 6거점",x:63,y:82.5,region:3},
  {id:"se-07",name:"남동 7거점",x:55,y:79,region:3},{id:"se-08",name:"남동 8거점",x:59.5,y:72,region:3},
  {id:"se-09",name:"남동 9거점",x:54,y:57,region:3},{id:"se-10",name:"남동 10거점",x:67.5,y:57,region:3},
  {id:"ne-01",name:"북동 1거점",x:68,y:46.5,region:4},{id:"ne-02",name:"북동 2거점",x:79,y:42.5,region:4},
  {id:"ne-03",name:"북동 3거점",x:86,y:35.5,region:4},{id:"ne-04",name:"북동 4거점",x:78.5,y:29,region:4},
  {id:"ne-05",name:"북동 5거점",x:88.5,y:25,region:4},{id:"ne-06",name:"북동 6거점",x:72.5,y:27,region:4},
  {id:"ne-07",name:"북동 7거점",x:79.5,y:20,region:4},{id:"ne-08",name:"북동 8거점",x:90,y:17,region:4},
  {id:"ne-09",name:"북동 9거점",x:74,y:11,region:4},{id:"ne-10",name:"북동 10거점",x:86,y:10.5,region:4},
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
