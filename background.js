
//cookie header 탐지 (브라우저가 웹서버에 쿠키 전송 & 웹서버가 활용하는 쿠키 정보)
chrome.webRequest.onBeforeSendHeaders.addListener(
  details => {
    const cookieHdr = (details.requestHeaders || [])
      .find(h => h.name.toLowerCase() === "cookie");

    if (cookieHdr) {
      chrome.storage.local.set({ requestCookies: cookieHdr.value });
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

//set-cookie 헤더 탐지 (웹서버가 브라우저에 쿠키 심는 것)
chrome.webRequest.onHeadersReceived.addListener(
  details => {
    const setCookieValues = (details.responseHeaders || [])
      .filter(h => h.name.toLowerCase() === "set-cookie")
      .map(h => h.value);

    if (setCookieValues.length > 0) {
      chrome.storage.local.set({ responseCookies: setCookieValues });
    }
  },
  {
    urls: ["<all_urls>"],
    types: ["main_frame", "sub_frame", "xmlhttprequest", "script", "image"]
  },
  ["responseHeaders", "extraHeaders"]
);


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "block_cookie" && message.cookie) {
        const {name, domain} = message.cookie;
        // 1. 쿠키 즉시 삭제
        chrome.cookies.getAll({domain}, (cookies) => {
            cookies.forEach((c) => {
                if (c.name === name) {
                    chrome.cookies.remove({url: (c.secure ? "https://" : "http://") + c.domain.replace(/^\./, "") + (c.path || "/"), name: c.name});
                }
            });
        });
        // 2. 차단목록 저장
        chrome.storage.local.get({blockedCookies: []}, ({blockedCookies}) => {
            // 중복 저장 방지
            if (!blockedCookies.some(bc => bc.name === name && bc.domain === domain)) {
                blockedCookies.push({name, domain});
                chrome.storage.local.set({blockedCookies});
            }
        });
        // 3. declarativeNetRequest 규칙 추가 (동적 id: 10000~)
        chrome.declarativeNetRequest.getDynamicRules((rules) => {
            const newRuleId = 10000 + Math.floor(Math.random() * 89999);
            // 패턴: 이 쿠키이름이 포함된 Cookie 헤더 삭제
            const rule = {
                id: newRuleId,
                priority: 1,
                action: { type: "removeHeader", header: "cookie" },
                condition: {
                    urlFilter: domain,
                    resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"],
                    requestHeaders: [{header: "cookie", operation: "contains", value: name + "="}]
                }
            };
            chrome.declarativeNetRequest.updateDynamicRules({addRules: [rule], removeRuleIds: []});
        });
    }
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "unblock_cookie" && message.cookie) {
        const {name, domain} = message.cookie;
        // 1. blockedCookies에서 삭제
        chrome.storage.local.get({blockedCookies: []}, ({blockedCookies}) => {
            const newList = blockedCookies.filter(c => !(c.name === name && c.domain === domain));
            chrome.storage.local.set({blockedCookies: newList});
        });
        // 2. DNR 규칙 삭제 (동적 규칙 전체 조회 후 조건 일치하는 것만 삭제)
        chrome.declarativeNetRequest.getDynamicRules(rules => {
            const targetIds = rules
              .filter(rule => rule.action && rule.action.type === "removeHeader"
                && rule.condition && rule.condition.requestHeaders
                && rule.condition.requestHeaders.some(h => h.value && h.value.includes(name+"="))
                && rule.condition.urlFilter && rule.condition.urlFilter.includes(domain)
              )
              .map(rule => rule.id);
            if (targetIds.length)
              chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds: targetIds});
        });
        if (sendResponse) sendResponse();
        return true;
    }
});


// [자동 삭제] 쿠키 차단(onChanged)
chrome.cookies.onChanged.addListener(function(changeInfo) {
  chrome.storage.local.get({blockedCookies: []}, ({blockedCookies}) => {
    if (!changeInfo.cookie) return;
    blockedCookies.forEach(({name, domain}) => {
      if (changeInfo.cookie.name === name && changeInfo.cookie.domain.endsWith(domain)) {
        chrome.cookies.remove({
          url: (changeInfo.cookie.secure ? "https://" : "http://") + changeInfo.cookie.domain.replace(/^\./, ""),
          name: name
        });
      }
    });
  });
});

// ----- 쿠키 차단 (MV3 DNR Set-Cookie 차단룰 동적 생성/삭제) -----
// 각 차단 쿠키별 동적 룰 id를 생성 (도메인+이름 조합 해시 등)
function getRuleId(cookie) {
  // 도메인+이름을 10진 해시로 변환 (id는 1~MAX)
  let str = (cookie.domain || "") + "|" + (cookie.name || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash<<5)-hash)+str.charCodeAt(i);
  return Math.abs(hash % 20000) + 10000; // id 10000~29999
}

async function addCookieBlockRule(cookie) {
  const ruleId = getRuleId(cookie);
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [{
      id: ruleId,
      priority: 1,
      action: { type: "modifyHeaders", responseHeaders: [
        {header: "set-cookie", operation: "remove"} // 모든 Set-Cookie 헤더 제거
      ] },
      condition: {
        resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "script", "image"],
        requestDomains: [cookie.domain.replace(/^\./, "")]
      }
    }],
    removeRuleIds: []
  });
}

async function removeCookieBlockRule(cookie) {
  const ruleId = getRuleId(cookie);
  await chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [],
    removeRuleIds: [ruleId]
  });
}

// 기존 block_cookie, unblock_cookie 핸들러 내부에서 위 함수 호출 추가
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "block_cookie") {
    // 기존 localStorage 저장 + 쿠키삭제 로직...
    addCookieBlockRule(msg.cookie);
    // ...나머지 로직
  }
  if (msg.action === "unblock_cookie") {
    removeCookieBlockRule(msg.cookie);
    // ...나머지 로직
  }
});
