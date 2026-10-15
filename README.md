# Bot100 Log

VALORANT 射撃場の「Bot 100体撃ち」のタイムを記録・分析する静的Webアプリ。ビルド不要で GitHub Pages にそのまま置けます。

## 機能

- **モード切替**（画面上部。記録・集計・履歴・目標すべてが選択中のモードに連動）
  - **100体（タイム／秒・少ないほど良い）**: 移動なし / 移動あり ← メイン
  - **30秒（撃破数／体・多いほど良い）**: Easy / Medium / Hard
- **記録**: 整数値を ±1 ボタン、または数値にカーソルを合わせてマウスホイールで調整（初期値は前回の記録値）。日付、任意で武器・スキン
- **武器・スキン選択**: [valorant-api.com](https://valorant-api.com/) から武器・スキン画像を取得して画像で選択（デフォルトはノーマル）。取得データは必要項目のみ localStorage に7日間キャッシュ
- **今日のサマリー**: 回数 / 平均 / ベスト / 前回練習日比
- **自己ベスト更新の通知**
- **集計**: 自己ベスト、総試行数、練習日数、連続練習日数、直近7日平均と前7日比
- **成長グラフ**: 日別平均・日別ベスト・7日移動平均・試行回数・目標ライン（どのモードも上に行くほど良い記録）
- **分布**: ヒストグラム
- **武器・スキン別**: 条件ごとの回数・平均・ベスト
- **練習カレンダー**: 直近20週のヒートマップ（全モード合算）
- **履歴**: 日別一覧（クリックで各試行を展開・削除）
- **目標**: モードごとに設定
- **データ管理**: JSON 書き出し／読み込み（マージ）、CSV 書き出し
- **アカウント（Discord ログイン）**: 記録をアカウントに保存して端末間で同期。オフライン中の記録は次回接続時に送信
- **ランキング**: 公開ユーザー同士でモード別ベストを比較。行をクリックで相手の成長グラフ。設定で非公開にできる

ログインしなくても使えます（ゲスト）。その場合データはこのブラウザの localStorage にのみ保存され、ログイン時にアカウントへ取り込めます。

## 構成

```
index.html
css/style.css
js/app.js      # 画面・集計（依存: Chart.js, valorant-api.com）
js/cloud.js    # Supabase との通信（認証・同期・ランキング）
js/config.js   # Supabase の URL / Publishable key
supabase/schema.sql  # テーブル・RLS・ランキング用ビュー
```

## アカウント機能のセットアップ（Supabase + Discord）

`js/config.js` が空のままならログイン機能は表示されず、ゲスト専用で動きます。

1. **Supabase プロジェクト作成**: https://supabase.com でプロジェクトを作る（無料プランで可）
2. **スキーマ作成**: ダッシュボード → SQL Editor に `supabase/schema.sql` の中身を貼って Run
3. **Discord アプリ作成**: https://discord.com/developers/applications → New Application → OAuth2
   - Redirects に `https://<プロジェクトID>.supabase.co/auth/v1/callback` を追加
   - Client ID と Client Secret を控える
4. **Supabase で Discord を有効化**: Authentication → Sign In / Providers → Discord を ON、Client ID / Secret を入力
5. **リダイレクト先の許可**: Authentication → URL Configuration
   - Site URL: `https://bucq.github.io/botlog/`
   - Redirect URLs: `https://bucq.github.io/botlog/` と `http://localhost:8000/`
6. **接続設定**: Project Settings → API Keys の Project URL と Publishable key を `js/config.js` に記入（公開して問題ないキー。他人のデータは RLS で保護）

## ローカルで確認

```bash
python3 -m http.server 8000
```

http://localhost:8000 を開く。

## GitHub Pages で公開

1. GitHub にリポジトリを作成して push
2. リポジトリの Settings → Pages → Source を「Deploy from a branch」、Branch を `main` / `(root)` に設定
3. `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます
