import json,sys,collections,statistics,os
SS=os.environ.get('STORY_START'); MPP=float(os.environ.get('STORY_MPP','4'))
def clock(p):
    h,m=map(int,SS.split(':')); tot=int(h*60+m+p*MPP)%1440; return f"{(tot//60)%12 or 12}:{tot%60:02d}{'pm' if tot//60>=12 else 'am'}"
run=sys.argv[1]; out=sys.argv[2]
d=json.load(open(run+"/replay.json")); meta=json.load(open(run+"/run.json"))
names=d['agentNames']; lines=[]; per=collections.Counter(); noop=collections.Counter(); priv=0; lens=[]; replies=0
t0=meta['startedAt']; pstart={}
for p in d['pulses']:
    ts=[e['createdAt'] for e in p['committedEvents']]
    if ts: pstart[p['pulseIndex']]=min(ts)
for p in d['pulses']:
    for e in p['committedEvents']:
        a=names.get(e['actorId'],e['actorId']); t=(e['createdAt']-t0)/1000
        if e['type'] in ('message_sent','reply_sent'):
            c=e['payload'].get('content',''); per[e['actorId']]+=1; lens.append(len(c)); replies+= e['type']=='reply_sent'
            if e['channelId']!='building': priv+=1
            stamp=f"{clock(p['pulseIndex'])} p{p['pulseIndex']:02d}" if SS else f"t+{t:5.0f}s p{p['pulseIndex']:02d}"
            lines.append(f"[{stamp} #{e['channelId'][:14]}{' reply' if e['type']=='reply_sent' else ''}] {a}: {c}")
        elif e['type']=='no_op_recorded': noop[e['actorId']]+=1
        elif e['type'] in ('channel_created','agent_invited'):
            stamp=f"{clock(p['pulseIndex'])} p{p['pulseIndex']:02d}" if SS else f"t+{t:5.0f}s p{p['pulseIndex']:02d}"
            lines.append(f"[{stamp}] ({e['type']}) {a} {json.dumps(e['payload'])[:80]}")
open(out,'w').write("\n".join(lines))
dur=(meta['endedAt']-meta['startedAt'])/1000; gaps=[(b-a)/1000 for a,b in zip(sorted(pstart.values()),sorted(pstart.values())[1:])]
stats=dict(duration_s=round(dur,1),pulses=meta['pulsesRun'],s_per_pulse=round(dur/max(1,meta['pulsesRun']),1),
 messages=sum(per.values()),msgs_per_agent=dict(per),replies=replies,non_public_msgs=priv,noops=dict(noop),
 mean_msg_chars=round(statistics.mean(lens)) if lens else 0, pulse_gap_median_s=round(statistics.median(gaps),1) if gaps else None, pulse_gap_max_s=round(max(gaps),1) if gaps else None,
 llm_failures=meta['counters']['llmFailures'])
json.dump(stats,open(out.replace('.txt','.stats.json'),'w'),indent=1); print(json.dumps(stats))
