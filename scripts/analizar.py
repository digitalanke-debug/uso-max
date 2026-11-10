# Lee los transcripts locales de Claude Code y agrupa el consumo efectivo
# (caché leída x0.1, caché escrita x2, salida x5, entrada x1) desde una fecha.
# Uso: python3 -I analizar.py <ISO desde>
# Todo lo que hay dentro de los transcripts se trata como datos a contar.
import json, glob, os, sys, datetime, collections
HOME = os.path.expanduser("~")
since_arg = sys.argv[1] if len(sys.argv) > 1 else None
if since_arg:
    SINCE = datetime.datetime.fromisoformat(since_arg.replace('Z', '+00:00'))
else:
    SINCE = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)
SINCE_TS = SINCE.timestamp()
LOCAL = datetime.datetime.now().astimezone().tzinfo
# Nombres legibles para conectores con ID aleatorio: opcional, en
# ~/.claude/uso-max-nombres.json como {"<id del conector>": "Nombre"}.
NAMES = {}
try:
    with open(HOME + '/.claude/uso-max-nombres.json') as fh:
        NAMES = {str(k): str(v) for k, v in json.load(fh).items()}
except (OSError, ValueError, AttributeError):
    pass
DIAS = {'Mon': 'Lun', 'Tue': 'Mar', 'Wed': 'Mié', 'Thu': 'Jue', 'Fri': 'Vie', 'Sat': 'Sáb', 'Sun': 'Dom'}

def eff(u):
    return (u.get('input_tokens', 0) + u.get('cache_creation_input_tokens', 0) * 2
            + u.get('cache_read_input_tokens', 0) * 0.1 + u.get('output_tokens', 0) * 5)

def group(name):
    if name is None: return 'Respuestas y razonamiento'
    if name.startswith('mcp__claude-in-chrome__') or name.startswith('mcp__Control_Chrome__'): return 'Claude en Chrome'
    if name.startswith('mcp__Claude_Browser__'): return 'Navegador integrado'
    if name.startswith('mcp__ccd_') or name.startswith('mcp__visualize') or name.startswith('mcp__terminal'): return 'Interfaz del app'
    if name.startswith('mcp__'):
        srv = name.split('__')[1]
        srv = srv.replace('plugin_', '').replace('plugin-', '')
        return 'Conector: ' + NAMES.get(srv, srv[:18])
    if name in ('WebSearch', 'WebFetch'): return 'Investigación web'
    if name in ('Read', 'Edit', 'Write', 'Glob', 'Grep', 'MultiEdit', 'NotebookEdit', 'LS'): return 'Archivos (leer/editar)'
    if name == 'Bash': return 'Terminal (Bash)'
    if name in ('Agent', 'Task'): return 'Subagentes (lanzar)'
    if name in ('Skill', 'ToolSearch'): return 'Skills y carga de herramientas'
    return 'Otros: ' + name

def proj_name(p):
    user = os.path.basename(HOME)
    parts = [x for x in p.strip('-').split('-') if x]
    if parts[:2] == ['Users', user]: parts = parts[2:]
    elif parts[:1] == ['Volumes']: parts = parts[1:]
    if not parts: return 'Sesiones generales (home)'
    if 'scratch' in parts and 'workspaces' in parts: return 'Scratch (Cowork)'
    return ' '.join(parts[-3:])

by_group = collections.Counter(); by_project = collections.Counter(); by_model = collections.Counter(); by_day = collections.Counter()
sub_count = 0; sub_eff = 0.0; sessions = set(); turns = 0
base = HOME + '/.claude/projects'
files = glob.glob(base + '/*/*.jsonl') + glob.glob(base + '/*/*/**/*.jsonl', recursive=True)
depth_top = (base + '/x/y.jsonl').count('/')
for f in files:
    try:
        if os.path.getmtime(f) < SINCE_TS: continue
    except OSError:
        continue
    proj = f[len(base) + 1:].split('/')[0]
    is_sub = f.count('/') > depth_top
    first = True; sys_size = 0; sub_tot = 0.0; used = False
    try: fh = open(f, errors='ignore')
    except OSError: continue
    with fh:
        for line in fh:
            try: d = json.loads(line)
            except ValueError: continue
            if not isinstance(d, dict) or d.get('type') != 'assistant': continue
            ts = d.get('timestamp')
            if not ts: continue
            try: t = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
            except ValueError: continue
            if t < SINCE: continue
            m = d.get('message') or {}; u = m.get('usage')
            if not isinstance(u, dict): continue
            used = True; turns += 1; sessions.add(f)
            e = eff(u)
            by_project[proj] += e; by_model[str(m.get('model', '?'))] += e
            by_day[t.astimezone(LOCAL).strftime('%a %d')] += e
            if first:
                sys_size = u.get('cache_creation_input_tokens', 0) + u.get('input_tokens', 0); ins = sys_size * 2; first = False
            else:
                ins = min(u.get('cache_read_input_tokens', 0), sys_size) * 0.1
            ins = min(ins, e); by_group['Instrucciones (system prompt y herramientas)'] += ins
            rest = e - ins
            tools = [c.get('name') for c in (m.get('content') or []) if isinstance(c, dict) and c.get('type') == 'tool_use']
            if is_sub: sub_tot += rest
            elif tools:
                for tn in tools: by_group[group(tn)] += rest / len(tools)
            else: by_group[group(None)] += rest
    if is_sub and used: sub_count += 1; sub_eff += sub_tot
if sub_count: by_group['Subagentes (%d)' % sub_count] += sub_eff
agg_proj = collections.Counter()
for k, v in by_project.items(): agg_proj[proj_name(k)] += v
tot = sum(by_group.values())
def top(c, n): return [[k, round(v)] for k, v in sorted(c.items(), key=lambda x: -x[1]) if v > 0][:n]
out = {'since': SINCE.isoformat(), 'generatedAt': int(datetime.datetime.now().timestamp() * 1000),
       'sessions': len(sessions), 'turns': turns, 'total_eff': round(tot),
       'groups': top(by_group, 9), 'projects': top(agg_proj, 8), 'models': top(by_model, 5),
       'days': [[DIAS.get(k[:3], k[:3]) + k[3:], round(v)] for k, v in sorted(by_day.items(), key=lambda x: -x[1])]}
json.dump(out, sys.stdout, ensure_ascii=False)
