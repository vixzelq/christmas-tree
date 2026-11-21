#!/usr/bin/env node
/**
 * 一键部署到 GitHub Pages（不需要本地安装 git）
 *
 * 用法：
 *   1. 在 GitHub 生成一个 Fine-grained token：Repository access 选 christmas-tree，
 *      Permissions → Contents: Read and write（如要自动开启 Pages，再加 Pages: Read and write）
 *   2. PowerShell:
 *        $env:GITHUB_TOKEN="github_pat_xxx"
 *        node deploy.mjs
 *   3. 或者直接：node deploy.mjs github_pat_xxx
 *
 * 可选：
 *   node deploy.mjs --dry-run   只查看会新增/删除哪些文件，不上传
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const OWNER = process.env.GH_OWNER || 'nobody-r';
const REPO = process.env.GH_REPO || 'christmas-tree';
const BRANCH = process.env.GH_BRANCH || 'main';
const ROOT = process.cwd();
const SKIP = new Set(['deploy.mjs', '.git', 'node_modules']);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const token = process.env.GITHUB_TOKEN || args.find((a) => !a.startsWith('--')) || '';

const API = 'https://api.github.com';

function headers(extra = {}) {
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'xmas-tree-deploy',
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra
  };
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: headers(body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status} ${json?.message || text.slice(0, 200)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.isFile()) {
      const rel = relative(ROOT, full).split(sep).join('/');
      out.push({ path: rel, full, size: (await stat(full)).size });
    }
  }
  return out;
}

function fmt(n) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

async function main() {
  console.log(`仓库：${OWNER}/${REPO}  分支：${BRANCH}${dryRun ? '  [dry-run]' : ''}`);
  if (!token && !dryRun) {
    console.error('\n缺少 GITHUB_TOKEN。请先设置环境变量，或运行：node deploy.mjs <token>\n');
    process.exit(1);
  }

  const files = await walk(ROOT);
  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  console.log(`本地文件：${files.length} 个，共 ${fmt(totalBytes)}`);

  // 读取远端 HEAD（公开仓库无需 token 也能读）
  let head = null;
  try {
    head = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  } catch (err) {
    if (err.status === 404) {
      console.error(`找不到分支 ${BRANCH}，请确认仓库和分支名。`);
      process.exit(1);
    }
    throw err;
  }
  const headSha = head.object.sha;
  const commit = await api('GET', `/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
  const baseTree = commit.tree.sha;
  const remoteTree = await api('GET', `/repos/${OWNER}/${REPO}/git/trees/${baseTree}?recursive=1`);

  const localPaths = new Set(files.map((f) => f.path));
  const deletions = (remoteTree.tree || [])
    .filter((t) => t.type === 'blob' && !localPaths.has(t.path))
    .map((t) => t.path);

  console.log(`将新增/更新 ${files.length} 个文件`);
  if (deletions.length) {
    console.log(`将删除仓库中 ${deletions.length} 个旧文件：`);
    for (const p of deletions.slice(0, 12)) console.log(`  - ${p}`);
    if (deletions.length > 12) console.log(`  ... 还有 ${deletions.length - 12} 个`);
  }

  if (dryRun) {
    console.log('\n[dry-run] 检查完成，没有上传任何文件。');
    return;
  }

  // 上传 blob（逐个，避免单次请求过大）
  const treeEntries = [];
  let uploaded = 0;
  for (const file of files) {
    const content = await readFile(file.full);
    const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
      content: content.toString('base64'),
      encoding: 'base64'
    });
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    uploaded++;
    if (uploaded % 10 === 0 || uploaded === files.length) {
      console.log(`已上传 ${uploaded}/${files.length}`);
    }
  }

  for (const path of deletions) {
    treeEntries.push({ path, mode: '100644', type: 'blob', sha: null });
  }

  const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, {
    base_tree: baseTree,
    tree: treeEntries
  });
  const newCommit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: 'feat: 手势粒子圣诞树（分享链接 / 烟花 / 自动性能）',
    tree: tree.sha,
    parents: [headSha]
  });
  await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    sha: newCommit.sha,
    force: false
  });
  console.log(`\n已推送到 ${BRANCH}，commit ${newCommit.sha.slice(0, 7)}`);

  // 确保 Pages 开启（token 没有 pages 权限时会跳过）
  try {
    const pages = await api('GET', `/repos/${OWNER}/${REPO}/pages`);
    console.log(`Pages 已开启：${pages.html_url || `https://${OWNER}.github.io/${REPO}/`}`);
  } catch (err) {
    if (err.status === 404) {
      try {
        await api('POST', `/repos/${OWNER}/${REPO}/pages`, {
          source: { branch: BRANCH, path: '/' }
        });
        console.log('已开启 GitHub Pages（首次构建约 1 分钟）');
      } catch (e2) {
        console.log('未能自动开启 Pages，请在仓库 Settings → Pages 里选择 main / (root)。');
      }
    } else {
      console.log('无法读取 Pages 状态，可稍后到仓库 Settings → Pages 查看。');
    }
  }

  console.log(`\n稍等 1–2 分钟，访问：https://${OWNER}.github.io/${REPO}/`);
}

main().catch((err) => {
  console.error('\n部署失败：', err.message);
  if (err.status === 401) console.error('token 无效或已过期。');
  if (err.status === 403) console.error('token 权限不足：需要 Contents: Read and write。');
  process.exit(1);
});
