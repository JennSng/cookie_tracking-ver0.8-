// ---- 쿠키 정보 유틸 함수들 ----
function getDomainReputation(domain) {
  if (!domain) return '';
  const d = domain.toLowerCase();
  if (d.endsWith('.ru') || d.includes('ads') || d.includes('track')) return '위험';
  if (d.includes('cloud') || d.includes('cdn')) return '의심';
  return '신뢰';
}

function getUsageLevel(domain, purpose, allCookies) {
  let count = 0;
  (allCookies || []).forEach(c => {
    if (c.domain === domain && c.purpose === purpose) count++;
  });
  if (count >= 8) return '매우높음';
  if (count >= 5) return '높음';
  if (count >= 3) return '중간';
  if (count >= 2) return '낮음';
  return '매우낮음';
}

function getSecurityLevel(cookie) {
  if (cookie.secure && cookie.httpOnly && cookie.sameSite && cookie.sameSite.toLowerCase() !== 'none') {
    return '안전';
  }
  return '주의';
}

function classifyType(domain, expires, currentDomain) {
  if (!expires || expires === '세션') return '세션';
  if (domain.startsWith('.') && !currentDomain.endsWith(domain.replace(/^\./, '')))
    return '서드파티';
  if (currentDomain.endsWith(domain.replace(/^\./, '')))
    return '퍼스트파티';
  return '기타';
}

function classifyUnlabeledPurpose(cookieName, domain) {
  const nameDomain = (cookieName + ' ' + domain).toLowerCase();
  if (nameDomain.includes("ad") || nameDomain.includes("ads") ||
      nameDomain.includes("doubleclick") || nameDomain.includes("adnxs") ||
      nameDomain.includes("googlesyndication")) return "Advertising";
  if (nameDomain.includes("ga") || nameDomain.includes("gtag") ||
      nameDomain.includes("stat") || nameDomain.includes("analytics") ||
      nameDomain.includes("counter")) return "Analytics";
  if (nameDomain.includes("facebook") || nameDomain.includes("twitter") ||
      nameDomain.includes("linkedin") || nameDomain.includes("instagram")) return "Social";
  return "Other";
}
function getPurpose(cookieName, domain, type, disconnectMap) {
  if (type !== '서드파티') return '';
  const base = domain.split('.').slice(-2).join('.');
  const mapped = disconnectMap[base] || 'Others';
  return mapped === 'Others' ? classifyUnlabeledPurpose(cookieName, domain) : mapped;
}

function formatKoreanExpires(expires) {
  if (!expires || expires === '세션') return '세션';
  const expDate = new Date(expires);
  const now = new Date();
  const diffDays = Math.floor((expDate - now) / (1000 * 60 * 60 * 24));
  const daysLabel = diffDays > 0 ? `${diffDays}일 이후` : '만료됨';
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const dayOfWeek = weekdays[expDate.getUTCDay()];
  return `${daysLabel} (${expDate.getUTCFullYear()}-${String(expDate.getUTCMonth()+1).padStart(2,'0')}-${String(expDate.getUTCDate()).padStart(2,'0')} ${dayOfWeek} ${expDate.toTimeString().slice(0,8)} GMT)`;
}

// ---- 차단/해제 버튼 ----
function createBlockButton(cookieObj, tr, onBlock) {
  const btn = document.createElement('button');
  btn.textContent = '차단';
  btn.className = 'btn';
  btn.onclick = function() {
    chrome.storage.local.get({blockedCookies: []}, ({blockedCookies}) => {
      if (!blockedCookies.some(b => b.name === cookieObj.name && b.domain === cookieObj.domain && b.expires === cookieObj.expires)) {
        blockedCookies.push(cookieObj);
        chrome.storage.local.set({blockedCookies}, () => {
          if (typeof onBlock === 'function') onBlock();
        });
      }
    });
    if (tr) tr.remove();
  };
  return btn;
}

function createUnblockButton(name, domain, expires, tr, onUnblock) {
  const btn = document.createElement('button');
  btn.textContent = '해제';
  btn.className = 'btn';
  btn.onclick = function() {
    chrome.storage.local.get({blockedCookies: []}, ({blockedCookies}) => {
      const next = blockedCookies.filter(
        b => !(b.name === name && b.domain === domain && b.expires === expires)
      );
      chrome.storage.local.set({blockedCookies: next}, () => {
        if (typeof onUnblock === 'function') onUnblock();
      });
    });
    if (tr) tr.remove();
  };
  return btn;
}

// ====== 전체 쿠키 + 페이징 ======
const ROWS_PER_PAGE = 15;
let allCookiesList = [], currentPage = 1, totalPages = 1, disconnectMap = {};

// 테이블 렌더링
function renderTablePage(pageNum) {
  const table = document.getElementById('allCookiesTable').getElementsByTagName('tbody')[0];
  table.innerHTML = '';
  const start = (pageNum - 1) * ROWS_PER_PAGE;
  const rows = allCookiesList.slice(start, start + ROWS_PER_PAGE);
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 9;
    td.textContent = "쿠키가 없습니다.";
    tr.appendChild(td);
    table.appendChild(tr);
    return;
  }
  rows.forEach(cookie => {
    const tr = document.createElement('tr');
    [
      cookie.type, // 종류
      cookie.purpose,
      cookie.name,
      cookie.domain,
      cookie.domainTrust,
      cookie.usage,
      cookie.security,
      cookie.expiresStr,
      '' // 차단버튼
    ].forEach((val, idx) => {
      const td = document.createElement('td');
      td.textContent = val || '';
      tr.appendChild(td);
      if (idx === 8) td.appendChild(createBlockButton(cookie, tr, () => { renderBlockedCookies(); }));
    });
    table.appendChild(tr);
  });
}

// ----------- 페이지네이션 (그룹별/화살표/현재페이지) -----------
function renderPagination() {
  const pagDiv = document.getElementById('pagination');
  pagDiv.innerHTML = '';
  if (totalPages <= 1) return;

  const GROUP_SIZE = 5;
  const currentGroup = Math.floor((currentPage - 1) / GROUP_SIZE);
  const groupStart = currentGroup * GROUP_SIZE + 1;
  const groupEnd = Math.min(groupStart + GROUP_SIZE - 1, totalPages);

  // 이전 그룹(<)
  const prev = document.createElement('span');
  prev.textContent = '<';
  prev.style.marginRight = '24px';
  prev.style.fontSize = '2em';
  prev.style.cursor = (groupStart === 1) ? 'not-allowed' : 'pointer';
  prev.style.color = (groupStart === 1) ? '#bbb' : '#444';
  if (groupStart > 1) {
    prev.onclick = () => {
      currentPage = groupStart - 1;
      renderTablePage(currentPage);
      renderPagination();
    };
  }
  pagDiv.appendChild(prev);

  // 현재 그룹의 페이지
  for (let p = groupStart; p <= groupEnd; ++p) {
    const page = document.createElement('span');
    page.textContent = p;
    page.style.margin = '0 18px';
    page.style.fontSize = '1.7em';
    page.style.fontWeight = (p === currentPage) ? 'bold' : '';
    page.style.color = (p === currentPage) ? 'limegreen' : '#444';
    page.style.cursor = (p === currentPage) ? 'default' : 'pointer';
    if (p !== currentPage) page.onclick = () => { currentPage = p; renderTablePage(currentPage); renderPagination(); };
    pagDiv.appendChild(page);
  }

  // 다음 그룹(>)
  const next = document.createElement('span');
  next.textContent = '>';
  next.style.marginLeft = '24px';
  next.style.fontSize = '2em';
  next.style.cursor = (groupEnd === totalPages) ? 'not-allowed' : 'pointer';
  next.style.color = (groupEnd === totalPages) ? '#bbb' : '#444';
  if (groupEnd < totalPages) {
    next.onclick = () => {
      currentPage = groupEnd + 1;
      renderTablePage(currentPage);
      renderPagination();
    };
  }
  pagDiv.appendChild(next);
}

// ====== 차단 쿠키 목록 ======
function renderBlockedCookies() {
  chrome.storage.local.get({blockedCookies: [], allCookies: []}, ({blockedCookies, allCookies}) => {
    const tbody = document.getElementById("blockedCookiesTable").getElementsByTagName('tbody')[0];
    tbody.innerHTML = "";
    if (!blockedCookies.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.textContent = "차단된 쿠키가 없습니다.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    blockedCookies.forEach(({name, domain, expires, type}) => {
      const purpose = getPurpose(name, domain, type, disconnectMap || {});
      const domainTrust = getDomainReputation(domain);
      const usage = getUsageLevel(domain, purpose, allCookies || []);
      const security = getSecurityLevel({ domain, name });
      const expiresStr = formatKoreanExpires(expires);

      const tr = document.createElement("tr");
      [
        purpose || "",
        domain || "",
        domainTrust || "",
        usage || "",
        security || "",
        expiresStr || ""
      ].forEach(val => {
        const td = document.createElement("td");
        td.textContent = val;
        tr.appendChild(td);
      });
      // 해제 버튼
      const tdUnblock = document.createElement("td");
      tdUnblock.appendChild(createUnblockButton(name, domain, expires, tr, renderBlockedCookies));
      tr.appendChild(tdUnblock);
      tbody.appendChild(tr);
    });
  });
}

// ====== 메인 ======
document.addEventListener("DOMContentLoaded", () => {
  fetch(chrome.runtime.getURL("re_services.json"))
    .then(res => res.json())
    .then(disconnect => {
      disconnectMap = {};
      for (const category in disconnect.categories) {
        disconnect.categories[category].forEach(org => {
          for (const name in org) {
            const domains = Object.values(org[name]).flat();
            domains.forEach(d => {
              const base = d.split('.').slice(-2).join('.');
              disconnectMap[base] = category;
            });
          }
        });
      }

      chrome.cookies.getAll({}, cookiesArr => {
        // 쿠키 정보를 가공해서 컬럼 맞게 변환
        const currentDomain = location.hostname;
        allCookiesList = cookiesArr.map(c => {
          const type = classifyType(c.domain, c.expirationDate ? new Date(c.expirationDate*1000).toUTCString() : "세션", currentDomain);
          const expires = c.expirationDate ? new Date(c.expirationDate*1000).toUTCString() : "세션";
          const purpose = getPurpose(c.name, c.domain, type, disconnectMap);
          return {
            type, // 종류
            purpose,
            name: c.name,
            domain: c.domain,
            domainTrust: getDomainReputation(c.domain),
            usage: getUsageLevel(c.domain, purpose, cookiesArr),
            security: getSecurityLevel(c),
            expiresStr: formatKoreanExpires(expires),
            expires,
          };
        });
        totalPages = Math.ceil(allCookiesList.length / ROWS_PER_PAGE);
        renderTablePage(currentPage);
        renderPagination();
        renderBlockedCookies();
      });
    });
});