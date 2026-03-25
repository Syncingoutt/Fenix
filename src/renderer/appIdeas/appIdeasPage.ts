import { ElectronAPI } from '../types.js';

declare const electronAPI: ElectronAPI;

const GITHUB_ISSUES_URL = 'https://github.com/Syncingoutt/Fenix/issues';
const GITHUB_NEW_ISSUE_URL = 'https://github.com/Syncingoutt/Fenix/issues/new';
const GITHUB_ISSUES_API_URL = 'https://api.github.com/repos/Syncingoutt/Fenix/issues?state=open&per_page=50';
const VOTES_STORAGE_KEY = 'fenix_app_ideas_votes';

type VoteValue = -1 | 0 | 1;

interface GitHubLabel {
  name: string;
  color: string;
}

interface GitHubReactions {
  '+1'?: number;
  '-1'?: number;
}

interface GitHubIssue {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  updated_at?: string;
  comments: number;
  labels: GitHubLabel[];
  reactions?: GitHubReactions;
  pull_request?: unknown;
}

type VotesMap = Record<string, VoteValue>;

let issuesCache: GitHubIssue[] = [];
let isLoading = false;
let lastLoadedAt = 0;
const REFRESH_INTERVAL_MS = 2 * 60 * 1000;

function getVotes(): VotesMap {
  try {
    const raw = localStorage.getItem(VOTES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const votes: VotesMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === 1 || value === -1 || value === 0) {
        votes[key] = value;
      }
    }
    return votes;
  } catch {
    return {};
  }
}

function setVotes(votes: VotesMap): void {
  localStorage.setItem(VOTES_STORAGE_KEY, JSON.stringify(votes));
}

function getIssueVote(issueNumber: number): VoteValue {
  const votes = getVotes();
  return votes[String(issueNumber)] ?? 0;
}

function setIssueVote(issueNumber: number, vote: VoteValue): void {
  const votes = getVotes();
  const key = String(issueNumber);
  if (vote === 0) {
    delete votes[key];
  } else {
    votes[key] = vote;
  }
  setVotes(votes);
}

function sanitize(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatRelativeDateFromNow(dateLike: string): string {
  const timestamp = new Date(dateLike).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) {
    const mins = Math.max(1, Math.floor(diffMs / minute));
    return `${mins}m ago`;
  }
  if (diffMs < day) {
    const hours = Math.max(1, Math.floor(diffMs / hour));
    return `${hours}h ago`;
  }
  const days = Math.max(1, Math.floor(diffMs / day));
  return `${days}d ago`;
}

function isIdeaIssue(issue: GitHubIssue): boolean {
  const labelNames = (issue.labels || []).map(label => label.name.toLowerCase());
  if (labelNames.some(name => name.includes('feature') || name.includes('suggestion') || name.includes('idea'))) {
    return true;
  }
  const title = issue.title.toLowerCase();
  return title.includes('idea') || title.includes('suggestion') || title.includes('feature');
}

function renderIssueCard(issue: GitHubIssue): string {
  const vote = getIssueVote(issue.number);
  const labels = issue.labels ?? [];
  const upvotes = issue.reactions?.['+1'] ?? 0;
  const downvotes = issue.reactions?.['-1'] ?? 0;
  const score = upvotes - downvotes + vote;
  const bodyText = (issue.body || '').trim();
  const preview = bodyText.length > 220 ? `${bodyText.slice(0, 220)}...` : bodyText;
  const updated = formatRelativeDateFromNow(issue.updated_at || '');

  return `
    <article class="app-ideas-card" data-issue-number="${issue.number}">
      <div class="app-ideas-card-header">
        <a class="app-ideas-title-link" href="${sanitize(issue.html_url)}" data-open-issue="${issue.number}">
          #${issue.number} ${sanitize(issue.title)}
        </a>
        <div class="app-ideas-meta">
          <span>${issue.comments} comments</span>
          ${updated ? `<span>${sanitize(updated)}</span>` : ''}
        </div>
      </div>
      ${preview ? `<p class="app-ideas-preview">${sanitize(preview)}</p>` : ''}
      <div class="app-ideas-labels">
        ${labels.map((label) => `<span class="app-ideas-label" style="--label-color:#${sanitize(label.color || '7e7e7e')}">${sanitize(label.name)}</span>`).join('')}
      </div>
      <div class="app-ideas-actions">
        <div class="app-ideas-vote-group">
          <button class="app-ideas-vote-btn ${vote === 1 ? 'active' : ''}" data-vote="up" data-issue="${issue.number}" title="Upvote">
            ▲ Upvote
          </button>
          <button class="app-ideas-vote-btn ${vote === -1 ? 'active' : ''}" data-vote="down" data-issue="${issue.number}" title="Downvote">
            ▼ Downvote
          </button>
          <span class="app-ideas-score">Score: ${score}</span>
        </div>
        <button class="app-ideas-open-btn" data-open-issue="${issue.number}">Open on GitHub</button>
      </div>
    </article>
  `;
}

function renderIdeas(): void {
  const list = document.getElementById('appIdeasList');
  if (!list) return;

  if (issuesCache.length === 0) {
    list.innerHTML = `
      <div class="app-ideas-empty">
        <div>No open ideas yet.</div>
        <button id="appIdeasOpenIssuesFromEmpty" class="app-ideas-submit-btn secondary">Open GitHub Issues</button>
      </div>
    `;
    const emptyBtn = document.getElementById('appIdeasOpenIssuesFromEmpty');
    emptyBtn?.addEventListener('click', () => electronAPI.openExternal(GITHUB_ISSUES_URL));
    return;
  }

  list.innerHTML = issuesCache.map(renderIssueCard).join('');
}

function setStatus(message: string, variant: 'muted' | 'error' = 'muted'): void {
  const status = document.getElementById('appIdeasStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', variant === 'error');
}

async function loadIssues(force = false): Promise<void> {
  if (isLoading) return;
  const fresh = Date.now() - lastLoadedAt <= REFRESH_INTERVAL_MS;
  if (!force && fresh && issuesCache.length > 0) {
    renderIdeas();
    setStatus('Showing cached ideas.');
    return;
  }

  isLoading = true;
  setStatus('Loading ideas...');
  const list = document.getElementById('appIdeasList');
  if (list && issuesCache.length === 0) {
    list.innerHTML = '<div class="app-ideas-loading">Loading GitHub issues...</div>';
  }

  try {
    const response = await fetch(GITHUB_ISSUES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json'
      }
    });
    if (!response.ok) {
      throw new Error(`GitHub request failed (${response.status})`);
    }

    const data = (await response.json()) as GitHubIssue[];
    issuesCache = (data || []).filter(issue => !issue.pull_request && isIdeaIssue(issue));
    lastLoadedAt = Date.now();
    renderIdeas();
    setStatus(`Loaded ${issuesCache.length} ideas from GitHub.`);
  } catch (error) {
    setStatus('Failed to load ideas. You can still open GitHub issues directly.', 'error');
    if (list && issuesCache.length === 0) {
      list.innerHTML = `
        <div class="app-ideas-empty">
          <div>Could not load ideas right now.</div>
          <button id="appIdeasOpenIssuesOnError" class="app-ideas-submit-btn secondary">Open GitHub Issues</button>
        </div>
      `;
      const errorBtn = document.getElementById('appIdeasOpenIssuesOnError');
      errorBtn?.addEventListener('click', () => electronAPI.openExternal(GITHUB_ISSUES_URL));
    }
  } finally {
    isLoading = false;
  }
}

function closeMyAccountMenu(settingsMenuState: { open: boolean }): void {
  settingsMenuState.open = false;
  const myAccountMenu = document.getElementById('myAccountMenu');
  if (myAccountMenu) myAccountMenu.style.display = 'none';
  const myAccountButton = document.getElementById('myAccountButton');
  if (myAccountButton) myAccountButton.classList.remove('active');
}

function handleIdeaListClicks(event: Event): void {
  const mouseEvent = event as MouseEvent;
  const target = event.target as HTMLElement;
  const issueBtn = target.closest('[data-open-issue]') as HTMLElement | null;
  if (issueBtn) {
    mouseEvent.preventDefault();
    const issueNumber = issueBtn.getAttribute('data-open-issue');
    const issue = issuesCache.find(it => String(it.number) === issueNumber);
    if (issue) {
      electronAPI.openExternal(issue.html_url);
    }
    return;
  }

  const voteBtn = target.closest('[data-vote]') as HTMLElement | null;
  if (!voteBtn) return;

  const issueIdRaw = voteBtn.getAttribute('data-issue');
  const voteType = voteBtn.getAttribute('data-vote');
  const issueNumber = Number(issueIdRaw);
  if (!issueNumber || (voteType !== 'up' && voteType !== 'down')) return;

  const current = getIssueVote(issueNumber);
  const next: VoteValue = voteType === 'up' ? (current === 1 ? 0 : 1) : (current === -1 ? 0 : -1);
  setIssueVote(issueNumber, next);
  renderIdeas();
}

export function initAppIdeasPage(settingsMenuState: { open: boolean }): void {
  const appIdeasBtn = document.getElementById('appIdeasBtn') as HTMLButtonElement | null;
  const appIdeasBackBtn = document.getElementById('appIdeasBackBtn') as HTMLButtonElement | null;
  const appIdeasSubmitBtn = document.getElementById('appIdeasSubmitBtn') as HTMLButtonElement | null;
  const appIdeasRefreshBtn = document.getElementById('appIdeasRefreshBtn') as HTMLButtonElement | null;
  const appIdeasList = document.getElementById('appIdeasList');
  const page = document.getElementById('page-app-ideas');

  appIdeasBtn?.addEventListener('click', () => {
    closeMyAccountMenu(settingsMenuState);
    (window as any).navigateToPage?.('app-ideas');
    void loadIssues();
  });

  appIdeasBackBtn?.addEventListener('click', () => {
    (window as any).navigateToPage?.('home');
  });

  appIdeasSubmitBtn?.addEventListener('click', () => {
    electronAPI.openExternal(GITHUB_NEW_ISSUE_URL);
  });

  appIdeasRefreshBtn?.addEventListener('click', () => {
    void loadIssues(true);
  });

  appIdeasList?.addEventListener('click', handleIdeaListClicks);

  if (page) {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') continue;
        if (page.classList.contains('active')) {
          void loadIssues();
        }
      }
    });
    observer.observe(page, { attributes: true });
  }
}
