// ---- 도메인 신뢰도 ----
function getDomainReputation(domain) {
  if (!domain) return '';
  const d = domain.toLowerCase();
  if (d.endsWith('.ru') || d.includes('ads') || d.includes('track')) return '위험';
  if (d.includes('cloud') || d.includes('cdn')) return '의심';
  return '신뢰';
}

// ---- 활용도 ----
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

// ---- 보안 ----
function getSecurityLevel(cookie) {
  if (cookie.secure && cookie.httpOnly && cookie.sameSite && cookie.sameSite.toLowerCase() !== 'none') {
    return '안전';
  }
  return '주의';
}

// ---- 목적 분류 (v0.6 로직 준수) ----
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
  // v0.6 방식: 서드파티만 disconnectMap 및 키워드 매핑
  if (type !== '서드파티') return '';
  const base = domain.split('.').slice(-2).join('.');
  const mapped = (disconnectMap && disconnectMap[base]) || 'Others';
  return mapped === 'Others' ? classifyUnlabeledPurpose(cookieName, domain) : mapped;
}

// ---- 만료일 ----
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

// ---- 종류(서드/퍼스트) 분류 ----
function classifyType(domain, expires, currentDomain) {
  if (!expires || expires === '세션') return '세션';
  if (domain.startsWith('.') && !currentDomain.endsWith(domain.replace(/^\./, '')))
    return '서드파티';
  if (currentDomain.endsWith(domain.replace(/^\./, '')))
    return '퍼스트파티';
  return '기타';
}

// ----- 차단/해제 버튼 -----
function createBlockButton(cookieRowObj, tr) {
  const btn = document.createElement('button');
  btn.textContent = '차단';
  btn.onclick = function() {
    chrome.runtime.sendMessage({
      action: "block_cookie",
      cookie: cookieRowObj // name, domain, expires, type 등만 저장
    });
    if (tr) tr.remove();
    setTimeout(renderBlockedCookies, 100);
  };
  return btn;
}

function createUnblockButton(name, domain, expires, tr) {
  const btn = document.createElement('button');
  btn.textContent = '해제';
  btn.onclick = function() {
    chrome.runtime.sendMessage({
      action: "unblock_cookie",
      cookie: { name, domain, expires }
    }, () => renderBlockedCookies());
    if (tr) tr.remove();
    setTimeout(renderBlockedCookies, 100);
  };
  return btn;
}

// ====== 차단 목록 테이블 (동적계산) ======
function renderBlockedCookies() {
  chrome.storage.local.get(
    { blockedCookies: [], allCookies: [], disconnectMap: {} },
    ({ blockedCookies, allCookies, disconnectMap }) => {
      const tbody = document.getElementById("blockedCookiesTable");
      if (!tbody) return;
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
      blockedCookies.forEach(({ name, domain, expires, type }) => {
        // type, name, domain, expires만 저장했다면
        // type은 실제 저장된 type이 아니라, 다시 계산해도 됨 (ex: 차단 시점 type이 "서드파티"였다면 그대로 전달)
        const currentDomain = location.hostname;
        const realType = type || classifyType(domain, expires, currentDomain); // 혹시 type이 없으면 재계산
        const purpose = getPurpose(name, domain, realType, disconnectMap || {});
        const domainTrust = getDomainReputation(domain);
        const usage = getUsageLevel(domain, purpose, allCookies || []);
        const security = getSecurityLevel({ domain, name }); // raw정보만 있을 때는 약식
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
        // 해제 버튼: name, domain, expires까지 넘겨줌
        const tdUnblock = document.createElement("td");
        tdUnblock.appendChild(createUnblockButton(name, domain, expires, tr));
        tr.appendChild(tdUnblock);
        tbody.appendChild(tr);
      });
    }
  );
}

// ====== 메인: 표 + 차단목록 동시 렌더 ======
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["requestCookies", "responseCookies", "allCookies"], (data) => {
    fetch(chrome.runtime.getURL("re_services.json"))
      .then(res => res.json())
      .then(disconnect => {
        const disconnectMap = {};
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
        chrome.storage.local.set({ disconnectMap }); // 차단목록에서도 목적 분류 쓸 수 있게 저장

        const currentDomain = location.hostname;

        // ---- My쿠키(요청) 표 ----
        const headerTable = document.getElementById("cookieHeaderTable");
        headerTable.innerHTML = "";
        const cookieHeaderStr = data.requestCookies || "";
        const cookieArr = cookieHeaderStr.split(";").map(s => s.trim()).filter(Boolean);

        cookieArr.forEach(item => {
          const [name, ...rest] = item.split("=");
          const value = rest.join("=");
          chrome.cookies.getAll({ name: name.trim() }, cookiesArr => {
            let matchedCookie = null;
            for (const cookie of cookiesArr) {
              if (cookie.value === value.trim()) {
                matchedCookie = cookie;
                break;
              }
            }
            if (!matchedCookie) return;

            const domain = matchedCookie.domain;
            const expDate = matchedCookie.expirationDate
              ? new Date(matchedCookie.expirationDate * 1000).toUTCString()
              : "세션";
            // **type 계산**
            const type = classifyType(domain, expDate, currentDomain);
            const purpose = getPurpose(name.trim(), domain, type, disconnectMap);

            const tr = document.createElement("tr");
            [
              purpose,
              domain,
              getDomainReputation(domain),
              getUsageLevel(domain, purpose, data.allCookies || []),
              getSecurityLevel(matchedCookie),
              formatKoreanExpires(expDate),
              ""
            ].forEach(val => {
              const td = document.createElement("td");
              td.textContent = val;
              tr.appendChild(td);
            });
            // 차단 버튼
            const tdBlock = tr.lastChild;
            tdBlock.appendChild(createBlockButton({
              name: name.trim(),
              domain,
              expires: expDate,
              type
            }, tr));
            headerTable.appendChild(tr);
          });
        });

        // ---- Set-Cookie(심어진 쿠키) 표 ----
        const setBody = document.getElementById("setCookies");
        setBody.innerHTML = "";
        (data.responseCookies || []).forEach(str => {
          // 예시 파싱 (필요시 parseSetCookieString 등 함수로 대체)
          const parts = str.split(';').map(p => p.trim());
          const [name, value] = parts[0].split('=');
          const domainPart = parts.find(p => p.toLowerCase().startsWith('domain='));
          const expiresPart = parts.find(p => p.toLowerCase().startsWith('expires='));
          const securePart = parts.find(p => p.toLowerCase() === 'secure');
          const httpOnlyPart = parts.find(p => p.toLowerCase() === 'httponly');
          const sameSitePart = parts.find(p => p.toLowerCase().startsWith('samesite='));

          const domain = domainPart ? domainPart.split('=')[1] : currentDomain;
          const expires = expiresPart ? expiresPart.split('=')[1] : '세션';
          const secure = !!securePart;
          const httpOnly = !!httpOnlyPart;
          const sameSite = sameSitePart ? sameSitePart.split('=')[1] : undefined;

          const type = classifyType(domain, expires, currentDomain);
          const purpose = getPurpose(name, domain, type, disconnectMap);
          const tr = document.createElement("tr");
          [
            purpose,
            domain,
            getDomainReputation(domain),
            getUsageLevel(domain, purpose, data.allCookies || []),
            getSecurityLevel({secure, httpOnly, sameSite}),
            formatKoreanExpires(expires),
            ""
          ].forEach(val => {
            const td = document.createElement("td");
            td.textContent = val;
            tr.appendChild(td);
          });

          // 차단 버튼 (raw만 저장)
          const tdBlock = tr.lastChild;
          tdBlock.appendChild(createBlockButton({
            name,
            domain,
            expires,
            type
          }, tr));
          setBody.appendChild(tr);
        });

        // --- 차단목록 테이블 표시 (항상 마지막에) ---
        renderBlockedCookies();
      });
  });
});

// 전체 쿠키 리스트 버튼
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('openAllCookies');
  if (btn) {
    btn.addEventListener('click', () => {
      window.open(chrome.runtime.getURL('all_cookies.html'));
    });
  }
});
