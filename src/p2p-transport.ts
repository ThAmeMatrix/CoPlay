import type { Socket } from 'socket.io-client';

const BLOCK = 256 * 1024;
const FRAME = 16 * 1024;
type Pending = { buffer: Uint8Array; bytes: number; resolve: (data: ArrayBuffer) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
export class FilePeer {
  pc: RTCPeerConnection; channel?: RTCDataChannel;
  private requests = new Map<number, Pending>(); private counter = 0; private candidates: RTCIceCandidateInit[] = [];
  private closed = false; private queue = Promise.resolve(); private jobs = 0;
  received = 0; sent = 0;
  constructor(private socket: Socket, readonly remote: string, config: RTCConfiguration, private file: File | undefined, private state: (state: string) => void, private progress: () => void) {
    this.pc = new RTCPeerConnection(config);
    this.pc.onicecandidate = e => { if (e.candidate) this.signal({ candidate: e.candidate.toJSON() }); };
    this.pc.onconnectionstatechange = () => { this.state(this.pc.connectionState); if (['failed', 'closed', 'disconnected'].includes(this.pc.connectionState)) this.rejectAll('P2P 连接中断，请重新连接'); };
    this.pc.ondatachannel = e => this.bind(e.channel);
  }
  private signal(payload: object) { this.socket.emit('file:signal', { target: this.remote, ...payload }); }
  async offer() { this.bind(this.pc.createDataChannel('coplay-file-v1', { ordered: true })); await this.pc.setLocalDescription(await this.pc.createOffer()); this.signal({ description: this.pc.localDescription }); }
  async signalReceived(data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    if (this.closed) return;
    if (data.description) {
      await this.pc.setRemoteDescription(data.description);
      for (const c of this.candidates.splice(0)) await this.pc.addIceCandidate(c);
      if (data.description.type === 'offer') { await this.pc.setLocalDescription(await this.pc.createAnswer()); this.signal({ description: this.pc.localDescription }); }
    } else if (data.candidate) { if (this.pc.remoteDescription) await this.pc.addIceCandidate(data.candidate); else if (this.candidates.length < 100) this.candidates.push(data.candidate); }
  }
  private bind(channel: RTCDataChannel) {
    this.channel = channel; channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = 128 * 1024;
    channel.onopen = () => this.state('ready');
    channel.onclose = () => { this.state('closed'); this.rejectAll('P2P 数据通道已关闭'); };
    channel.onmessage = event => {
      if (typeof event.data === 'string') {
        if (event.data.length > 1000) return;
        let m; try { m = JSON.parse(event.data); } catch { return; }
        if (m.type === 'request' && this.file) {
          if (!Number.isInteger(m.id) || m.id < 1 || !Number.isSafeInteger(m.start) || !Number.isSafeInteger(m.length) || m.start < 0 || m.length < 1 || m.length > BLOCK || m.start + m.length > this.file.size || this.jobs >= 8) { channel.send(JSON.stringify({ type: 'error', id: m.id, error: '无效或过多的片段请求' })); return; }
          this.jobs++;
          this.queue = this.queue.then(async () => {
            const bytes = new Uint8Array(await this.file!.slice(m.start, m.start + m.length).arrayBuffer());
            for (let offset = 0; offset < bytes.length; offset += FRAME) {
              await this.backpressure();
              const part = bytes.subarray(offset, offset + FRAME); const frame = new Uint8Array(8 + part.length); const header = new DataView(frame.buffer);
              header.setUint32(0, m.id); header.setUint32(4, offset); frame.set(part, 8); channel.send(frame.buffer); this.sent += part.length;
            }
            this.progress();
          }).catch(() => { if (channel.readyState === 'open') channel.send(JSON.stringify({ type: 'error', id: m.id, error: '文件读取或传输失败' })); }).finally(() => { this.jobs--; });
        } else if (m.type === 'error') { const req = this.requests.get(m.id); if (req) { clearTimeout(req.timer); this.requests.delete(m.id); req.reject(new Error(String(m.error || '片段传输失败'))); } }
      } else if (event.data instanceof ArrayBuffer && event.data.byteLength >= 8) {
        const header = new DataView(event.data); const id = header.getUint32(0), offset = header.getUint32(4); const req = this.requests.get(id); if (!req) return;
        const bytes = new Uint8Array(event.data, 8);
        if (offset !== req.bytes || offset + bytes.length > req.buffer.length || !bytes.length) { clearTimeout(req.timer); this.requests.delete(id); req.reject(new Error('文件片段顺序或长度校验失败')); return; }
        req.buffer.set(bytes, offset); req.bytes += bytes.length; this.received += bytes.length;
        if (req.bytes === req.buffer.length) { clearTimeout(req.timer); this.requests.delete(id); req.resolve(req.buffer.buffer as ArrayBuffer); this.progress(); }
      }
    };
  }
  private async backpressure() {
    const c = this.channel; if (!c || c.readyState !== 'open') throw new Error('数据通道已关闭');
    if (c.bufferedAmount <= 512 * 1024) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); c.removeEventListener('bufferedamountlow', ready); c.removeEventListener('close', closed); };
      const ready = () => { cleanup(); resolve(); }; const closed = () => { cleanup(); reject(new Error('通道关闭')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('传输超时')); }, 20000);
      c.addEventListener('bufferedamountlow', ready, { once: true }); c.addEventListener('close', closed, { once: true });
      if (c.bufferedAmount <= c.bufferedAmountLowThreshold) ready();
    });
  }
  read(start: number, length: number): Promise<ArrayBuffer> {
    if (this.channel?.readyState !== 'open') return Promise.reject(new Error('P2P 尚未连接')); 
    if (this.requests.size >= 8) return Promise.reject(new Error('片段请求过多，请稍后重试'));
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(new Error('片段读取超时，请检查文件提供者是否在线')); }, 25000);
      this.requests.set(id, { buffer: new Uint8Array(length), bytes: 0, resolve, reject, timer });
      this.channel!.send(JSON.stringify({ type: 'request', id, start, length }));
    });
  }
  private rejectAll(message: string) { for (const r of this.requests.values()) { clearTimeout(r.timer); r.reject(new Error(message)); } this.requests.clear(); }
  close() { this.closed = true; this.rejectAll('P2P 会话已结束'); this.pc.close(); }
}
