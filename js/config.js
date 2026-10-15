// Supabase の接続設定。
// Project Settings → API Keys の「Project URL」と「Publishable key」を貼る（公開しても安全なキー。権限は RLS で制御）。
// 空のままならログイン機能は表示されず、ゲスト（このブラウザのみ保存）として動く。
window.BOTLOG_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
};
