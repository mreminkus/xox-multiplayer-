// Backend (server.js) Render/Railway/Fly.io gibi bir yere deploy edildikten sonra
// aşağıdaki satırı o backend'in URL'siyle doldur, örn:
// window.XOX_SERVER_URL = "https://xox-backend.onrender.com";
//
// Boş "" bırakılırsa sayfa kendi barındığı adrese (aynı origin) bağlanmaya
// çalışır. Bu, localde `npm start` ile test ederken doğru çalışır ama
// Netlify'da (frontend ile backend farklı adreslerde olduğu için) ÇALIŞMAZ —
// Netlify'a yüklemeden önce burayı mutlaka backend URL'in ile doldur.
window.XOX_SERVER_URL = "";
