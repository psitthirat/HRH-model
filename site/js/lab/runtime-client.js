// Importing this module starts no worker, CDN request or solver. A completed
// presentation baseline can still be read/exported when compute is unavailable.
const clone = value => structuredClone(value);
const cancelled = () => new DOMException('The computation was cancelled', 'AbortError');
const completed = status => ['completed', 'infeasible', 'failed', 'cancelled'].includes(status);

export class LabRuntimeClient {
  constructor({ labUrl, manifest = null, onStatus = null } = {}) {
    if (!labUrl) throw new TypeError('labUrl is required');
    this.labUrl = new URL(labUrl, document.baseURI).href;
    this.manifest = manifest && clone(manifest);
    this.onStatus = onStatus;
    this.worker = null;
    this.pending = new Map();
    this.runs = new Map();
    this.activeId = null;
  }

  async _manifest() {
    if (this.manifest) return this.manifest;
    const response = await fetch(this.labUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Lab release unavailable (${response.status})`);
    this.manifest = await response.json();
    return this.manifest;
  }

  async get_capabilities() {
    const manifest = await this._manifest();
    return {
      ...(clone(manifest.capabilities || {})),
      browser_compute: typeof Worker !== 'undefined' && Boolean(globalThis.crypto?.subtle),
      runtime: 'Pyodide 314.0.7 / SciPy HiGHS in a dedicated worker',
      cancellation: 'terminate_worker',
    };
  }

  _worker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./runtime-worker.js', import.meta.url), { type: 'module', name: 'workforce-lab' });
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      const task = this.pending.get(data.id);
      if (!task) return;
      if (data.type === 'progress') {
        task.onProgress?.({ run_id: data.id, stage: data.stage, detail: clone(data.detail || {}) });
      } else if (data.type === 'result') {
        this.pending.delete(data.id);
        task.resolve({ result: data.result, runtime: data.runtime });
      } else if (data.type === 'error') {
        this.pending.delete(data.id);
        const error = new Error(data.error?.message || 'Model computation failed');
        error.name = data.error?.name || 'RuntimeError';
        task.reject(error);
        // Failed module imports may remain cached inside a worker. Start fresh
        // on retry, including recovery after a temporary CDN/network failure.
        this._terminate(error);
      }
    };
    worker.onerror = event => {
      const error = new Error(event.message || 'Unable to load the browser compute runtime');
      this._terminate(error);
    };
    return worker;
  }

  _terminate(error = cancelled()) {
    this.worker?.terminate();
    this.worker = null;
    for (const task of this.pending.values()) task.reject(error);
    this.pending.clear();
  }

  async _request(action, config, { id, onProgress } = {}) {
    const manifest = await this._manifest();
    // Cancellation can happen while fetching the manifest, before a worker
    // exists. Do not accidentally start that cancelled run after fetch returns.
    if (action === 'run' && this.runs.get(id)?.status === 'cancelled') throw cancelled();
    return new Promise((resolve, reject) => {
      try {
        this.pending.set(id, { resolve, reject, onProgress });
        this._worker().postMessage({ id, action, config: clone(config), manifest, manifestURL: this.labUrl });
      } catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  _status(id, patch) {
    const run = this.runs.get(id);
    if (!run) return;
    Object.assign(run, patch);
    const status = this.get_run_status(id);
    this.onStatus?.(status);
    run.onProgress?.(status);
  }

  submit_run(config, { runId = crypto.randomUUID(), onProgress = null } = {}) {
    if (this.activeId) throw new Error('A computation is already running; cancel it before starting another');
    if (this.runs.has(runId)) throw new Error('A run ID cannot be reused');
    this.activeId = runId;
    const run = { run_id: runId, status: 'queued', stage: 'queued', config: clone(config), started_at: new Date().toISOString(), onProgress };
    this.runs.set(runId, run);
    this._status(runId, {});
    run.promise = this._request('run', run.config, {
      id: runId,
      onProgress: event => this._status(runId, { status: event.stage === 'validating' ? 'validating' : 'running', stage: event.stage, detail: event.detail }),
    }).then(({ result, runtime }) => {
      if (run.status === 'cancelled') throw cancelled();
      run.result = clone(result);
      const status = /infeasible/i.test(result.status || '') ? 'infeasible'
        : /failed|error|invalid/i.test(result.status || '') ? 'failed' : 'completed';
      this._status(runId, { status, stage: status, runtime, finished_at: new Date().toISOString() });
      return clone(result);
    }).catch(error => {
      this._status(runId, { status: error.name === 'AbortError' ? 'cancelled' : 'failed', stage: error.name === 'AbortError' ? 'cancelled' : 'failed', error: error.message, finished_at: new Date().toISOString() });
      throw error;
    }).finally(() => { if (this.activeId === runId) this.activeId = null; });
    // submit_run is intentionally immediate. Observe internally so delayed UI
    // calls to when_completed never create an unhandled rejection.
    run.promise.catch(() => {});
    return runId;
  }

  run(config, options = {}) { return this.when_completed(this.submit_run(config, options)); }
  when_completed(runId) {
    const run = this.runs.get(runId);
    if (!run) return Promise.reject(new Error('Unknown run ID'));
    return run.promise;
  }

  get_run_status(runId) {
    const run = this.runs.get(runId);
    if (!run) return null;
    const { config, result, promise, onProgress, ...status } = run;
    return clone(status);
  }

  get_results(runId) {
    const run = this.runs.get(runId);
    if (!run || !completed(run.status) || !run.result) return null;
    return clone(run.result);
  }

  async validate_scenario(config) {
    if (this.activeId || this.pending.size) throw new Error('Wait for the active computation before validating');
    return (await this._request('validate', config, { id: `validate-${crypto.randomUUID()}` })).result;
  }

  async compare_runs(runs) {
    if (this.activeId || this.pending.size) throw new Error('Wait for the active computation before comparing');
    const values = runs.map(value => typeof value === 'string' ? this.get_results(value) : clone(value));
    if (values.some(value => !value)) throw new Error('Comparisons require completed run results');
    return (await this._request('compare', values, { id: `compare-${crypto.randomUUID()}` })).result;
  }

  async summarize_experiments(items, limits = {}) {
    if (this.activeId || this.pending.size) throw new Error('Wait for the active computation before summarizing');
    const values = items.map(item => ({ ...clone(item), result: typeof item.result === 'string' ? this.get_results(item.result) : clone(item.result) }));
    if (values.some(value => !value.policy_id || !value.future_id || !value.result)) {
      throw new Error('Experiment summaries require policy/future identifiers and completed result objects');
    }
    return (await this._request('summarize', {items: values, limits: clone(limits)}, { id: `summarize-${crypto.randomUUID()}` })).result;
  }

  cancel_run(runId = this.activeId) {
    const run = this.runs.get(runId);
    if (!run || completed(run.status)) return false;
    this._status(runId, { status: 'cancelled', stage: 'cancelled', finished_at: new Date().toISOString() });
    this._terminate(cancelled());
    this.activeId = null;
    return true;
  }
  cancel(runId) { return this.cancel_run(runId); }
  dispose() { this.cancel_run(); this._terminate(); }
}
