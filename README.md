# 効果音リンク集

無料で使える効果音へのリンクをまとめた静的サイトです。カテゴリ絞り込み・キーワード検索・並び替え・日本語/英語の言語切り替えに対応しています。

公開URL: https://maincar.github.io/sound_effect_library/

## 仕組み

- 単一の `index.html` で完結する静的サイトです(ビルド不要)。
- 効果音データは、YouTubeチャンネル [@koukaon_library](https://www.youtube.com/@koukaon_library) から `scripts/sync-youtube.mjs` が自動取得し、`data/sounds.json` として保存したものを `fetch` で読み込みます。
- 広告データは、Google スプレッドシートを CSV としてエクスポートしたものを `fetch` で取得して描画します(従来通り)。
- 各効果音は `?sound=<slug>` のクエリパラメータで個別ページとして表示されます(タイトル・meta description・OGP・JSON-LDを動的に書き換え)。
- 言語切り替え(日本語/英語)はページ右上のボタンで行い、選択は `localStorage` に保存されます。効果音タイトル・カテゴリ名も英訳された状態で表示されます。

## データ同期の仕組み(YouTube → サイト)

`.github/workflows/sync-youtube.yml` が **毎日自動実行**(手動実行も可能)され、以下を行います。

1. YouTube Data API v3で `@koukaon_library` チャンネルの動画一覧を取得
2. チャンネルの **再生リスト(プレイリスト)をそのままカテゴリとして使用**(動画がどの再生リストに入っているかでカテゴリを自動判定)。どの再生リストにも属さない動画は「未分類」になります
3. DeepL API で日本語タイトル・カテゴリ名を英訳(既に翻訳済みのものは再翻訳しないようキャッシュされます)
4. `data/sounds.json` と `sitemap.xml` を生成し、変更があればリポジトリに自動コミット

つまり、**新しい効果音を追加したい場合はYouTube側に動画をアップロードするだけ**でよく、カテゴリを増やしたい場合はYouTube側で再生リストを作成して動画をそこに追加するだけで、翌日には(または手動実行すればすぐに)サイトに反映されます。

### 必要なSecretsのセットアップ

このワークフローを動かすには、リポジトリに以下の2つのSecretsを登録する必要があります(GitHubの `Settings → Secrets and variables → Actions` から登録)。

| Secret名 | 取得方法 |
| --- | --- |
| `YOUTUBE_API_KEY` | [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成し、YouTube Data API v3 を有効化してAPIキーを発行 |
| `DEEPL_API_KEY` | [DeepL](https://www.deepl.com/pro-api) で API Free プランに登録し、APIキーを発行(無料枠: 月50万文字) |

登録後、GitHubの Actions タブから `Sync YouTube data` ワークフローを "Run workflow" で手動実行すると、すぐにデータが同期されます。CLIからも実行できます。

```bash
gh workflow run sync-youtube.yml
```

## 広告のセットアップ(従来通り)

`index.html` 内の以下の定数を、実際のスプレッドシートに合わせて設定してください。

```js
const SHEET_ID = "ここにスプレッドシートID";
```

広告用に `ads` という名前のシートを用意し、「ウェブに公開」した状態にしてください。列は `enabled(ON/OFF), type(feed/bottom), title, image, link` の順にしてください。

## デプロイ

GitHub Pages で `main` ブランチのルートを公開する設定にするだけで動作します。効果音データは `sync-youtube.yml` が自動更新するので、コンテンツ追加のための手動デプロイ作業は不要です。
