'use client';

import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';

/**
 * HLS 屏幕诊断悬浮层（?hlsdebug=1 时挂载）
 *
 * 用途：iPad Safari 等移动端无法连电脑看控制台，把关键播放器状态
 * 直接画在屏幕上，用于远程排查"不缓冲/预取失效"类问题。
 * 轮询 video / video.hls / window.__prefetchDebug()，不影响正常播放。
 */

interface HlsDebugState {
  hasHls: boolean;
  hlsUrl: string;
  maxBufferLength: string;
  backBufferLength: string;
  maxBufferSize: string;
  maxMaxBufferLength: string;
  testBandwidth: string;
  currentTime: string;
  bufferedEnd: string;
  bufferedLen: string;
  ahead: string;
  readyState: string;
  paused: string;
  prefetch: string;
  lastError: string;
  uaMajor: string;
}

const fmt = (v: unknown): string => {
  if (v === undefined || v === null) return 'N/A';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return String(Math.round(v * 10) / 10);
  return String(v);
};

export function HlsDebugOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<HlsDebugState | null>(null);
  const lastErrorRef = useRef<string>('');
  const boundHlsRef = useRef<unknown>(null);

  useEffect(() => {
    try {
      setEnabled(new URLSearchParams(window.location.search).has('hlsdebug'));
    } catch {
      /* 忽略 */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const collect = () => {
      const video = document.querySelector('video') as
        (HTMLVideoElement & { hls?: any }) | null;
      const hls = video?.hls;
      let prefetch = 'N/A';
      try {
        const dbg = (window as any).__prefetchDebug?.();
        if (dbg) {
          prefetch =
            `ok=${fmt(dbg.okCount)} fail=${fmt(dbg.failCount)} ` +
            `cache=${fmt(dbg.cacheSize)} conc=${fmt(dbg.concurrency)} ` +
            `frags=${fmt(dbg.fragUrlCount)} miss=${fmt(dbg.missCount)}`;
        }
      } catch {
        /* 忽略 */
      }

      // hls 实例变化时重新绑定错误监听
      if (hls && hls !== boundHlsRef.current) {
        try {
          hls.on(Hls.Events.ERROR, (_e: unknown, data: any) => {
            lastErrorRef.current = `${data?.type || '?'}/${data?.details || '?'} fatal=${fmt(data?.fatal)}`;
          });
          boundHlsRef.current = hls;
        } catch {
          /* 忽略 */
        }
      }

      let bufferedEnd = 0;
      let bufferedLen = 0;
      let currentTime = 0;
      let readyState = -1;
      let paused = 'N/A';
      if (video) {
        currentTime = video.currentTime;
        readyState = video.readyState;
        paused = String(video.paused);
        try {
          bufferedLen = video.buffered.length;
          if (bufferedLen > 0) {
            bufferedEnd = video.buffered.end(video.buffered.length - 1);
          }
        } catch {
          /* 忽略 */
        }
      }

      const cfg = hls?.config || {};
      const ua = navigator.userAgent;
      const uaMajor = (ua.match(/Version\/(\d+)/) || [])[1] || '0';

      setState({
        hasHls: !!hls,
        hlsUrl: hls?.url
          ? hls.url.length > 70
            ? `...${hls.url.slice(-70)}`
            : hls.url
          : 'N/A',
        maxBufferLength: fmt(cfg.maxBufferLength),
        backBufferLength: fmt(cfg.backBufferLength),
        maxBufferSize: fmt(cfg.maxBufferSize),
        maxMaxBufferLength: fmt(cfg.maxMaxBufferLength),
        testBandwidth: fmt(cfg.testBandwidth),
        currentTime: fmt(currentTime),
        bufferedEnd: fmt(bufferedEnd),
        bufferedLen: fmt(bufferedLen),
        ahead: fmt(bufferedEnd - currentTime),
        readyState: fmt(readyState),
        paused,
        prefetch,
        lastError: lastErrorRef.current || 'none',
        uaMajor: `SafariMajor=${uaMajor}`,
      });
    };

    collect();
    const timer = setInterval(collect, 1000);
    return () => clearInterval(timer);
  }, [enabled]);

  if (!enabled || !state) return null;

  return (
    <div
      className='fixed left-2 top-2 z-[9999] max-w-[80vw] rounded bg-black/75 p-2 font-mono text-[10px] leading-4 text-white pointer-events-none'
      style={{ whiteSpace: 'pre-wrap' }}
    >
      {[
        `hls=${state.hasHls} ${state.uaMajor}`,
        `url=${state.hlsUrl}`,
        `maxBufLen=${state.maxBufferLength} back=${state.backBufferLength} size=${state.maxBufferSize} maxMax=${state.maxMaxBufferLength} testBW=${state.testBandwidth}`,
        `t=${state.currentTime} bufEnd=${state.bufferedEnd} ahead=${state.ahead} (len=${state.bufferedLen}) rs=${state.readyState} paused=${state.paused}`,
        `prefetch: ${state.prefetch}`,
        `lastErr: ${state.lastError}`,
      ].join('\n')}
    </div>
  );
}
