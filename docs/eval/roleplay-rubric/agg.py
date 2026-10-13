"""agg.py <label...>: backfill missing judge files, then print per-axis table (both judges) + deterministic metrics."""
import json,glob,os,subprocess,statistics,sys
S=os.path.dirname(os.path.abspath(__file__)); J=["glm-5.3-flash","qwen3.8-flash"]
axes=list(json.load(open(S+"/rubric.frozen.json"))["axes"])
for label in sys.argv[1:]:
    O=f"{S}/rounds/{label}"
    for tx in sorted(glob.glob(O+"/seed*.txt")):
        for j in J:
            out=tx.replace(".txt",f".{j}.json")
            if not os.path.exists(out): subprocess.run(["python3",S+"/judge.py",S,tx,j,out],capture_output=True)
    res={}
    for j in J:
        fs=sorted(glob.glob(f"{O}/seed*.{j}.json")); res[j]=(len(fs),{a:round(statistics.mean(json.load(open(f))["scores"][a] for f in fs),2) for a in axes} if fs else {})
    st=[json.load(open(f)) for f in glob.glob(O+"/seed*.stats.json")]
    print(f"== {label}  judged: "+", ".join(f"{j.split('-')[0]}={res[j][0]}" for j in J))
    print(f"{'axis':20}{'glm':>6}{'qwen':>6}{'min':>6}")
    for a in axes:
        g,q=res[J[0]][1].get(a),res[J[1]][1].get(a); print(f"{a:20}{g!s:>6}{q!s:>6}{min(x for x in (g,q) if x is not None) if g or q else '-'!s:>6}")
    allm=[x for j in J for x in res[j][1].values()]
    print("mean of all:",round(statistics.mean(allm),2) if allm else None)
    m=lambda k:round(statistics.mean(x[k] for x in st),1)
    print({k:m(k) for k in ("mean_msg_chars","s_per_pulse","messages","replies","non_public_msgs","pulse_gap_median_s")},"llm_failures",sum(x["llm_failures"] for x in st))
