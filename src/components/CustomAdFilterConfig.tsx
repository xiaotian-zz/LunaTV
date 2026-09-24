'use client';

import { AlertCircle, CheckCircle, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';

interface CustomAdFilterConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

const CustomAdFilterConfig = ({
  config,
  refreshConfig,
}: CustomAdFilterConfigProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [filterSettings, setFilterSettings] = useState({
    customAdFilterEnabled: true,
    customAdFilterCode: '',
    customAdFilterVersion: 1,
  });

  // 从config加载设置（开关未配置时默认开启）
  useEffect(() => {
    if (config?.SiteConfig) {
      setFilterSettings({
        customAdFilterEnabled:
          config.SiteConfig.CustomAdFilterEnabled !== false,
        customAdFilterCode: config.SiteConfig.CustomAdFilterCode || '',
        customAdFilterVersion: config.SiteConfig.CustomAdFilterVersion || 1,
      });
    }
  }, [config]);

  // 显示消息
  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // 保存配置
  const handleSave = async () => {
    setIsLoading(true);
    try {
      if (!config) {
        throw new Error('配置未加载');
      }

      // 合并完整的 AdminConfig
      const updatedConfig = {
        ...config,
        SiteConfig: {
          ...config.SiteConfig,
          CustomAdFilterEnabled: filterSettings.customAdFilterEnabled,
          CustomAdFilterCode: filterSettings.customAdFilterCode,
          CustomAdFilterVersion: filterSettings.customAdFilterVersion,
        },
      };

      const response = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || '保存失败');
      }

      showMessage('success', '去广告配置已保存');
      await refreshConfig();
    } catch (error: any) {
      showMessage('error', error.message || '保存失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 重置输入框（不保存）
  const handleReset = () => {
    setFilterSettings({
      customAdFilterEnabled: true,
      customAdFilterCode: '',
      customAdFilterVersion: 1,
    });
  };

  // 恢复默认并保存到数据库
  const handleRestoreDefault = async () => {
    setIsLoading(true);
    try {
      if (!config) {
        throw new Error('配置未加载');
      }

      // 合并完整的 AdminConfig，重置去广告配置
      const updatedConfig = {
        ...config,
        SiteConfig: {
          ...config.SiteConfig,
          CustomAdFilterEnabled: true,
          CustomAdFilterCode: '',
          CustomAdFilterVersion: 1,
        },
      };

      const response = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || '恢复默认失败');
      }

      setFilterSettings({
        customAdFilterEnabled: true,
        customAdFilterCode: '',
        customAdFilterVersion: 1,
      });

      showMessage('success', '已恢复为默认配置');
      await refreshConfig();
    } catch (error: any) {
      showMessage('error', error.message || '恢复默认失败');
    } finally {
      setIsLoading(false);
    }
  };

  // 默认示例代码（与播放页内置规则一致）
  const defaultExample = `// 自定义去广告函数
// 参数: type (播放源key), m3u8Content (m3u8文件内容)
// 返回: 过滤后的m3u8内容

function filterAdsFromM3U8(type, m3u8Content) {
  if (!m3u8Content) return '';

  // 广告关键字列表
  const adKeywords = [
    'sponsor',
    '/ad/',
    '/ads/',
    'advert',
    'advertisement',
    '/adjump',
    'redtraffic'
  ];
  const isAdUrl = (url) => {
    const lower = url.toLowerCase();
    return adKeywords.some((keyword) => lower.includes(keyword));
  };

  // ---------- 结构化解析 ----------
  // 1) 头部标签（EXTM3U 等）2) 分片（DISCONTINUITY/EXTINF/标签 + URL）3) 尾部（ENDLIST）
  const headLines = [];
  const tailLines = [];
  const frags = [];
  let phase = 'head';
  let curDisc = false;
  let curDur = 0;
  let curTags = [];

  for (const raw of m3u8Content.split('\\n')) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (phase === 'head') {
      if (!t) continue;
      if (t.startsWith('#EXT-X-DISCONTINUITY')) {
        curDisc = true;
        continue;
      }
      if (t.startsWith('#EXTINF:')) {
        curDur = parseFloat(t.slice(8)) || 0;
        curTags = [line];
        phase = 'body';
        continue;
      }
      headLines.push(line);
      continue;
    }
    if (phase === 'tail') {
      tailLines.push(line);
      continue;
    }
    // body
    if (!t) continue;
    if (t.startsWith('#EXT-X-ENDLIST')) {
      tailLines.push(line);
      phase = 'tail';
      continue;
    }
    if (t.startsWith('#EXT-X-DISCONTINUITY')) {
      curDisc = true;
      continue;
    }
    if (t.startsWith('#EXTINF:')) {
      curDur = parseFloat(t.slice(8)) || 0;
      curTags = [line];
      continue;
    }
    if (t.startsWith('#')) {
      curTags.push(line);
      continue;
    }
    // URL 行 → 一个分片完成
    frags.push({ disc: curDisc, dur: curDur, tagLines: curTags, url: line });
    curDisc = false;
    curDur = 0;
    curTags = [];
  }

  // 2) 标记待删除分片
  const drop = new Array(frags.length).fill(false);

  // 2a. URL 关键字广告
  frags.forEach((f, i) => {
    if (isAdUrl(f.url)) drop[i] = true;
  });

  // 2b. DISCONTINUITY 对包裹的广告段：
  //     两个相邻近 DISCONTINUITY 之间的分片总时长很短（≤90s）且含 <1s 碎分片
  //     —— 这类源广告 URL 无特征（hash 命名），靠此结构特征识别
  // 2c. 同样包夹结构但不要求碎分片：插播广告普遍 15-30s、3-8 片
  //     （实测 yzzy 源 16.5s×4 片，分片全 ≥1.7s，仅靠碎分片特征会漏）
  // 2d. 末尾段：以 DISCONTINUITY 开头直到文件尾（后跟 ENDLIST，
  //     没有第二个 DISCONTINUITY 包夹）的短段 —— 片尾贴片广告
  for (let i = 0; i < frags.length; i += 1) {
    if (!frags[i].disc) continue;
    let total = 0;
    let hasTiny = false;
    let count = 0;
    let j = i;
    while (j < frags.length) {
      if (j > i && frags[j].disc) break; // 遇到下一个 DISCONTINUITY 分片
      total += frags[j].dur;
      count += 1;
      if (frags[j].dur > 0 && frags[j].dur < 1) hasTiny = true;
      j += 1;
    }
    const enclosed = j < frags.length && frags[j].disc;
    const isAdSegment =
      total > 0 &&
      ((enclosed && total <= 90 && hasTiny) || // 2b 碎分片特征
        (total <= 30 && count <= 8)); // 2c/2d 短插播段（完整包夹或末尾）
    if (isAdSegment) {
      for (let k = i; k < j; k += 1) drop[k] = true;
    }
  }

  // 3) 输出：DISCONTINUITY 全部保留（时间戳跳变必须让播放器重新对齐，
  //    否则缓冲空洞 → 提前下一集、音画不同步）；广告删除点自动补插
  const out = [...headLines];
  let needDisc = false;
  let lastOutDisc = false;
  for (let i = 0; i < frags.length; i += 1) {
    const f = frags[i];
    if (drop[i]) {
      needDisc = true;
      continue;
    }
    if (f.disc) {
      if (!lastOutDisc) {
        out.push('#EXT-X-DISCONTINUITY');
        lastOutDisc = true;
      }
      needDisc = false;
    } else if (needDisc) {
      if (!lastOutDisc) {
        out.push('#EXT-X-DISCONTINUITY');
        lastOutDisc = true;
      }
      needDisc = false;
    }
    out.push(...f.tagLines);
    out.push(f.url);
    lastOutDisc = false;
  }
  out.push(...tailLines);

  return out.join('\\n');
}`;

  return (
    <div className='space-y-6'>
      {/* 标题和说明 */}
      <div className='flex items-start gap-3'>
        <Shield className='w-6 h-6 text-purple-500 shrink-0 mt-1' />
        <div className='flex-1'>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            去广告
          </h3>
          <p className='text-sm text-gray-600 dark:text-gray-400 mt-1'>
            播放时自动过滤 m3u8 中的广告片段，支持自定义过滤代码
          </p>
        </div>
      </div>

      {/* 启用开关 */}
      <div className='flex items-center justify-between bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4'>
        <div className='pr-4'>
          <h4 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
            启用去广告
          </h4>
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
            总开关：开启后按自定义代码（若有）或内置规则过滤广告；关闭后按源站原始内容播放。
          </p>
        </div>
        <label className='relative inline-flex items-center cursor-pointer shrink-0'>
          <input
            type='checkbox'
            checked={filterSettings.customAdFilterEnabled}
            onChange={(e) =>
              setFilterSettings({
                ...filterSettings,
                customAdFilterEnabled: e.target.checked,
              })
            }
            className='sr-only peer'
          />
          <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 dark:peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-purple-600"></div>
        </label>
      </div>

      {/* 信息提示 */}
      <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
        <div className='flex items-start gap-3'>
          <div className='text-sm text-blue-800 dark:text-blue-200'>
            <p className='font-medium mb-2'>使用说明：</p>
            <ul className='space-y-1 list-disc list-inside'>
              <li>
                不填自定义代码时，使用内置去广告规则（与上方示例代码逻辑一致）
              </li>
              <li>
                函数名必须为{' '}
                <code className='px-1 py-0.5 bg-blue-100 dark:bg-blue-800 rounded'>
                  filterAdsFromM3U8
                </code>
              </li>
              <li>
                接收两个参数：
                <code className='px-1 py-0.5 bg-blue-100 dark:bg-blue-800 rounded'>
                  type
                </code>
                （播放源key）和{' '}
                <code className='px-1 py-0.5 bg-blue-100 dark:bg-blue-800 rounded'>
                  m3u8Content
                </code>
                （m3u8内容）
              </li>
              <li>必须返回过滤后的 m3u8 内容字符串</li>
              <li>如果代码执行失败，将自动降级使用内置去广告规则</li>
              <li>修改代码后记得更新版本号，让浏览器刷新缓存</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 版本号 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          代码版本号
        </label>
        <input
          type='number'
          min='1'
          value={filterSettings.customAdFilterVersion}
          onChange={(e) =>
            setFilterSettings({
              ...filterSettings,
              customAdFilterVersion: parseInt(e.target.value) || 1,
            })
          }
          className='w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent'
          placeholder='1'
        />
        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
          每次修改代码后建议递增版本号
        </p>
      </div>

      {/* 代码编辑器 */}
      <div>
        <div className='flex items-center justify-between mb-2'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
            自定义代码
          </label>
          <button
            onClick={() =>
              setFilterSettings({
                ...filterSettings,
                customAdFilterCode: defaultExample,
              })
            }
            className='text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300'
          >
            载入示例代码
          </button>
        </div>
        <textarea
          value={filterSettings.customAdFilterCode}
          onChange={(e) =>
            setFilterSettings({
              ...filterSettings,
              customAdFilterCode: e.target.value,
            })
          }
          className='w-full h-96 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none'
          placeholder={defaultExample}
        />
        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
          支持纯 JavaScript 代码，不支持 TypeScript 类型注解
        </p>
      </div>

      {/* 消息提示 */}
      {message && (
        <div
          className={`flex items-center gap-2 p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className='w-5 h-5 shrink-0' />
          ) : (
            <AlertCircle className='w-5 h-5 shrink-0' />
          )}
          <span className='text-sm'>{message.text}</span>
        </div>
      )}

      {/* 操作按钮 */}
      <div className='flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700'>
        <button
          onClick={handleSave}
          disabled={isLoading}
          className='px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white rounded-lg font-medium transition-colors'
        >
          {isLoading ? '保存中...' : '保存配置'}
        </button>
        <button
          onClick={handleReset}
          disabled={isLoading}
          className='px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors'
        >
          重置
        </button>
        <button
          onClick={handleRestoreDefault}
          disabled={isLoading}
          className='px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400 text-white rounded-lg font-medium transition-colors'
        >
          {isLoading ? '恢复中...' : '恢复默认'}
        </button>
      </div>
    </div>
  );
};

export default CustomAdFilterConfig;
