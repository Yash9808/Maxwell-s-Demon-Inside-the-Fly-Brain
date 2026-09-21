import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
h = open('fly_demon_3d.html','rb').read().decode('utf-8','replace')
for probe in ['MCNS', 'btnMCNS', 'switchDataset', 'loadCircuit', 'DATASETS']:
    idx = 0; count = 0
    while True:
        i = h.find(probe, idx)
        if i == -1 or count > 8: break
        print(f'=== {probe} @ {i} ===')
        print(h[max(0,i-250):i+420].replace('\r','').replace('\n',' | ')[:700])
        print()
        idx = i + 1; count += 1
