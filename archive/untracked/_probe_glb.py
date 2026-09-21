import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
h = open('fly_demon_3d.html','rb').read().decode('utf-8','replace')
# how are scripts imported?
for probe in ['importmap', 'three.module.js', 'GLTFLoader', 'import ', 'script type="module"', 'script src=']:
    idx = 0; n = 0
    while n < 4:
        i = h.find(probe, idx)
        if i == -1: break
        print(f'=== {probe} @ {i} ===')
        print(h[max(0,i-160):i+220].replace('\r','').replace('\n',' | ')[:380])
        print()
        idx = i + 1; n += 1
# where does the layered/anat brain group live + btnAnat handler (insertion anchor)
i = h.find('$("btnAnat").addEventListener')
print('=== btnAnat handler ===')
print(h[i:i+900].replace('\r','').replace('\n',' | ')[:900])
