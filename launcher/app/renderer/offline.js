const u = new URLSearchParams(location.search).get("u") || "";
document.getElementById("retry").addEventListener("click", () => { if (/^https:\/\//.test(u)) location.href = u; });
