// Python/HiGHS stays in a dedicated worker: synchronous optimization cannot
// block slide navigation, and terminating this worker actually stops a run.
// Only this lazily created worker imports the pinned third-party runtime.
export const PYODIDE_VERSION = '314.0.7';
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
let runtimePromise;
let modelPromise;
let modelURL;
let active = false;
let runtimeVersions;

const send = (id, type, extra = {}) => self.postMessage({ id, type, ...extra });
const progress = (id, stage, detail = {}) => send(id, 'progress', { stage, detail });

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function verifiedBytes(url, expected) {
  if (!/^[a-f0-9]{64}$/i.test(expected || '')) throw new Error('Missing model asset SHA-256');
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Model asset unavailable (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (await sha256(bytes) !== expected.toLowerCase()) {
    throw new Error('Model asset checksum mismatch; reload the complete Lab release');
  }
  return new Uint8Array(bytes);
}

function assetURL(relative, base) {
  const parsed = new URL(relative, base);
  const folder = new URL('.', base);
  if (parsed.origin !== folder.origin || !parsed.pathname.startsWith(folder.pathname)) {
    throw new Error('Model asset must belong to the selected Lab release');
  }
  return parsed.href;
}

async function loadRuntime(id) {
  if (!runtimePromise) runtimePromise = (async () => {
    progress(id, 'loading_runtime', { runtime: `Pyodide ${PYODIDE_VERSION}` });
    const { loadPyodide } = await import(`${INDEX_URL}pyodide.mjs`);
    const py = await loadPyodide({ indexURL: INDEX_URL });
    // Package filenames and integrity hashes are pinned by this Pyodide lock.
    progress(id, 'loading_packages', { packages: ['numpy', 'scipy', 'pandas'] });
    await py.loadPackage(['numpy', 'scipy', 'pandas'], { checkIntegrity: true });
    runtimeVersions = JSON.parse(py.runPython("import json, sys, numpy, scipy, pandas\njson.dumps({'python':sys.version.split()[0], 'numpy':numpy.__version__, 'scipy':scipy.__version__, 'pandas':pandas.__version__})"));
    runtimeVersions.pyodide = PYODIDE_VERSION;
    return py;
  })().catch(error => { runtimePromise = null; throw error; });
  return runtimePromise;
}

async function loadModel(id, manifest, manifestURL) {
  if (modelURL && modelURL !== manifestURL) throw new Error('A worker cannot mix Lab releases');
  modelURL = manifestURL;
  if (!modelPromise) modelPromise = (async () => {
    const py = await loadRuntime(id);
    progress(id, 'loading_model');
    const files = manifest.engine_files;
    if (!Array.isArray(files) || !files.length) throw new Error('Lab has no executable model files');
    const decoder = new TextDecoder();
    const codeRoot = '/home/pyodide/hrh_lab';
    for (const file of files) {
      if (!/^(?:[a-zA-Z_][\w]*\/)*[a-zA-Z_][\w]*\.py$/.test(file.path || '')) {
        throw new Error('Invalid Python model module path');
      }
      const bytes = await verifiedBytes(assetURL(file.url, manifestURL), file.sha256);
      const target = `${codeRoot}/${file.path}`;
      py.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
      py.FS.writeFile(target, bytes);
    }
    const inputSpec = manifest.inputs;
    if (!inputSpec?.url) throw new Error('Lab has no versioned model inputs');
    const inputs = decoder.decode(await verifiedBytes(assetURL(inputSpec.url, manifestURL), inputSpec.sha256));
    // Module imports use only the reviewed Python source list. Configurations
    // are JSON values, never interpolated into executable Python code.
    py.globals.set('_hrh_inputs_json', inputs);
    py.globals.set('_hrh_versions_json', JSON.stringify({ ...(manifest.versions || {}), runtime: runtimeVersions }));
    py.runPython(`import sys\nsys.path.insert(0, '${codeRoot}')\nfrom chapter5 import lab_adapter as _hrh_adapter`);
    return py;
  })().catch(error => { modelPromise = null; throw error; });
  return modelPromise;
}

self.onmessage = async ({ data }) => {
  const { id, action, config, manifest, manifestURL } = data || {};
  if (!id || !['run', 'validate', 'compare', 'summarize'].includes(action)) return;
  if (active) { send(id, 'error', { error: { name: 'BusyError', message: 'A computation is already running' } }); return; }
  active = true;
  const started = performance.now();
  try {
    const py = await loadModel(id, manifest, manifestURL);
    const ready = performance.now();
    py.globals.set('_hrh_config_json', JSON.stringify(config));
    py.globals.set('_hrh_progress', (stage, detail = '{}') => {
      let decoded = detail;
      if (typeof detail === 'string') { try { decoded = JSON.parse(detail); } catch { decoded = { message: detail }; } }
      progress(id, String(stage), decoded);
    });
    progress(id, 'validating');
    const command = action === 'validate'
      ? `_hrh_adapter.validate_json(_hrh_config_json, _hrh_inputs_json, _hrh_versions_json)`
      : action === 'compare'
        ? `_hrh_adapter.compare_json(_hrh_config_json)`
        : action === 'summarize'
          ? `from chapter5 import lab_experiments as _hrh_experiments\n_hrh_experiments.summarize_json(_hrh_config_json)`
          : `_hrh_adapter.run_json(_hrh_config_json, _hrh_inputs_json, _hrh_versions_json, progress=_hrh_progress)`;
    const raw = await py.runPythonAsync(command);
    const result = JSON.parse(raw);
    send(id, 'result', { result, runtime: {
      ...runtimeVersions,
      initialization_ms: ready - started, computation_ms: performance.now() - ready,
      total_ms: performance.now() - started,
    } });
  } catch (error) {
    send(id, 'error', { error: { name: error.name || 'RuntimeError', message: error.message || String(error) } });
  } finally {
    active = false;
  }
};
