import sys, json, struct
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
p = 'drosophila_-_adult_fruit_fly_-_ct_scan.glb'
with open(p,'rb') as f:
    magic, ver, length = struct.unpack('<III', f.read(12))
    assert magic == 0x46546C67
    clen, ctype = struct.unpack('<II', f.read(8))
    js = json.loads(f.read(clen))
print('generator:', js.get('asset',{}).get('generator','?'))
print('meshes:', len(js.get('meshes',[])), 'nodes:', len(js.get('nodes',[])), 'images:', len(js.get('images',[])))
mins=[1e9]*3; maxs=[-1e9]*3
for m in js.get('meshes',[]):
    for pr in m.get('primitives',[]):
        ai = pr.get('attributes',{}).get('POSITION')
        if ai is None: continue
        a = js['accessors'][ai]
        if 'min' in a and 'max' in a:
            for k in range(3):
                mins[k]=min(mins[k],a['min'][k]); maxs[k]=max(maxs[k],a['max'][k])
print('bounds min:', [round(v,2) for v in mins])
print('bounds max:', [round(v,2) for v in maxs])
print('size:', [round(maxs[k]-mins[k],2) for k in range(3)])
# node names sample
names = [n.get('name','') for n in js.get('nodes',[])][:12]
print('node names:', names)
print()
g = open('GLTFLoader.module.js','r',encoding='utf-8',errors='replace').read(600)
print('GLTFLoader import head:')
print(g[:400])
