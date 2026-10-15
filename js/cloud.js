// Supabase（認証・記録の保存・ランキング）とのやり取りだけを担当する。
// 画面側（app.js）はアプリ内の形式（camelCase）だけを扱い、DB の形式（snake_case）はここで変換する。
(() => {
  'use strict';

  const cfg = window.BOTLOG_CONFIG || {};
  const configured = Boolean(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);
  const client = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  const PAGE = 1000; // PostgREST の1リクエストあたり上限

  const toRow = r => ({
    id: r.id,
    date: r.date,
    mode: r.mode,
    value: r.value,
    weapon_id: r.weaponId,
    weapon: r.weapon,
    skin_id: r.skinId,
    skin: r.skin,
    created_at: r.createdAt,
  });

  const fromRow = row => ({
    id: row.id,
    date: row.date,
    mode: row.mode,
    value: row.value,
    weaponId: row.weapon_id,
    weapon: row.weapon,
    skinId: row.skin_id,
    skin: row.skin,
    createdAt: row.created_at,
  });

  function must({ data, error }) {
    if (error) throw new Error(error.message);
    return data;
  }

  async function fetchAllPages(build) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const rows = must(await build().range(from, from + PAGE - 1));
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  window.BotlogCloud = {
    configured,

    // 認証状態が変わるたびに onChange(user | null) を呼ぶ（初回の復元時も呼ばれる）
    onAuthChange(onChange) {
      if (!client) return;
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'TOKEN_REFRESHED') return;
        // コールバック内で Supabase を呼ぶとデッドロックするため、処理は次のタスクに回す
        setTimeout(() => onChange(session?.user ?? null), 0);
      });
    },

    signIn() {
      return client.auth.signInWithOAuth({
        provider: 'discord',
        options: { redirectTo: location.origin + location.pathname },
      });
    },

    async signOut() {
      must(await client.auth.signOut());
    },

    async getProfile(userId) {
      return must(await client.from('profiles').select('id, display_name, avatar_url, is_public, goals').eq('id', userId).single());
    },

    async updateProfile(userId, patch) {
      return must(await client.from('profiles').update(patch).eq('id', userId).select().single());
    },

    async fetchOwnRecords(userId) {
      const rows = await fetchAllPages(() =>
        client.from('records').select('*').eq('user_id', userId).order('created_at').order('id'));
      return rows.map(fromRow);
    },

    async upsertRecords(records) {
      for (let i = 0; i < records.length; i += PAGE) {
        must(await client.from('records').upsert(records.slice(i, i + PAGE).map(toRow), { onConflict: 'user_id,id' }));
      }
    },

    async deleteRecords(userId, ids) {
      for (let i = 0; i < ids.length; i += 200) {
        must(await client.from('records').delete().eq('user_id', userId).in('id', ids.slice(i, i + 200)));
      }
    },

    async fetchLeaderboard(mode, better) {
      return must(await client
        .from('leaderboard')
        .select('user_id, display_name, avatar_url, best, recent_avg, attempts, last_date')
        .eq('mode', mode)
        .order('best', { ascending: better === 'low' })
        .order('attempts', { ascending: false })
        .limit(100));
    },

    async fetchUserRecords(userId, mode) {
      const rows = await fetchAllPages(() =>
        client.from('records').select('*').eq('user_id', userId).eq('mode', mode).order('created_at').order('id'));
      return rows.map(fromRow);
    },
  };
})();
