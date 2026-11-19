# 固定タイムステップ動画書き出し仕様書（SDD）

## 1. 目的
ブラウザの `MediaRecorder` リアルタイム収録では、実行環境の描画負荷によりフレーム間隔が 35〜42ms 程度ゆらぎ、6秒／12秒ループの終端フレームにわずかな不連続が生じる。
ローカル保存ブリッジ（`tools/export-bridge.cjs`）が利用可能かつシーンが時刻指定レンダリング（`renderAt(t)`）を提供する場合、固定タイムステップ（`t = k / fps`）でオフライン生成した PNG フレーム列を単一ストリームでブリッジへ送信し、**厳密な固定フレームレート・シームレスループの H.264 MP4** を生成する。

## 2. プロトコル仕様（Protocol 2 拡張）

### 2.1 エンドポイント
- `POST /save-frames?filename=<name>.mp4&fps=<fps>`
- 既存エンドポイントと同一の Origin / Host / `X-Picnic-Token` / `busy` 排他 / `maxUploadBytes` / タイムアウト / 切断時ロールバック / アトミック UUID 公開を適用する。
- `filename`：拡張子は `.mp4` のみ許可（それ以外は `400 invalid_filename`）。
- `fps`：整数 `1..60`（省略時は `30`）。範囲外・非整数は `400 invalid_fps`。
- `Content-Type`：`application/x-picnic-frames` のみ許可（それ以外は `400 invalid_content_type`）。

### 2.2 ボディ形式（長さプレフィックス付き PNG フレーム列）
```
[uint32BE frameLen_0][PNG bytes_0][uint32BE frameLen_1][PNG bytes_1]...
```
- フレーム数：`1 <= count <= 1800`（0 フレームまたは 1800 超は `400 invalid_frames`）。
- 各フレーム：
  - `frameLen >= 8` かつストリーム末尾で切り詰められていないこと（違反は `400 invalid_frames`）。
  - 先頭 8 バイトが PNG シグネチャ `89 50 4E 47 0D 0A 1A 0A` であること（違反は `400 invalid_media`）。

### 2.3 エンコード仕様（`tools/export-job.cjs`）
- `job.kind === 'frames'` を追加。
- 検証済み入力ファイルから長さプレフィックスに従い 1 フレームずつ読み出し、`ffmpeg` の標準入力へストリーム供給する（全フレームをメモリ展開しない）。
- `ffmpeg` 引数：
  ```
  -y -f image2pipe -vcodec png -framerate <fps> -i - -t 60
  -vf scale=1280:720:flags=neighbor -c:v libx264 -pix_fmt yuv420p
  -preset fast -crf 16 -movflags +faststart <output>
  ```
- 出力は 1280×720（ソース解像度 320×180 の 4 倍最近傍拡大）・H.264・固定フレームレート `<fps>`・再生時間 `count / fps` 秒となる。

## 3. クライアント仕様

### 3.1 `engine/bridge-client.js`
- `packFrames(frameBuffers)`：`Uint8Array[]` / `ArrayBuffer[]` を長さプレフィックス付き単一 `Uint8Array` へパックする純粋関数。
- `uploadFrames(frameBuffers, filename, fps = 30)`：`packFrames` でパックし、`POST /save-frames?filename=...&fps=...` へ `Content-Type: application/x-picnic-frames` で送信する。

### 3.2 `engine/capture.js`
- `createCapture` にオプション `renderAt`（`(t: number) => void`）および `fps = 30` を追加。
- `startVideo({ duration, filename, onProgress })` の動作：
  1. `typeof renderAt === 'function'` かつ `await bridgeAvailable()` が真のとき、**固定タイムステップ収録**を実行する。
     - `pixel.setFixedSize(source)` を設定（`320×180` のネイティブ解像度で軽量 PNG 化）。
     - `total = Math.round(duration * fps)` に対し、`k = 0 .. total - 1` を `t = k / fps` で `renderAt(t)` → PNG Blob 化 → `onProgress((k + 1) / fps, duration)`。
     - `stopVideo()` が呼ばれた場合はループを中断し、解像度と `state = 'idle'` を確実に復元してキャンセル（reject）する。
     - 全フレーム生成後、`bridgeClient.uploadFrames(frames, `${filename}.mp4`, fps)` で保存し、`{ where: 'downloads', filename, mime: 'video/mp4', ... }` を返す。
     - `finally` で必ず `pixel.setFixedSize(null)` と `renderOnce()` を実行して通常表示へ復帰する。
  2. `renderAt` が未指定、またはブリッジが利用不可の場合は、従来どおり `MediaRecorder` リアルタイム収録へ自動フォールバックする（後方互換 100% 維持）。
- `capture.fixedTimestep`（boolean getter）：固定タイムステップ録画の実行中のみ `true`、それ以外は `false`。

### 3.3 シーン側接続仕様（`nagisa.html` 等）
- `createCapture` へ `renderAt: t => step(0, { fixedTime: t })` を渡す。
- `step(dt, { fixedTime = null } = {})` のルール：
  1. `fixedTime === null && capture.fixedTimestep` のときは描画を行わず即 return し、`requestAnimationFrame` ループが固定タイムステップ録画中のフレームや `elapsed` を上書きしないようにする。
  2. `fixedTime !== null` のときは `elapsed = fixedTime` とし、リアルタイム録画用の `capture.frame()` を呼ばない。
  3. 録画中の `sky.update(0, elapsed, ...)`・`water.update`・`loopT = elapsed % LOOP` の挙動はリアルタイム録画と同一とする。

## 4. 受け入れ基準（TDD テスト項目）
1. **Bridge バリデーション**：`/save-frames` が不正 `fps`・不正 `Content-Type`・`.mp4` 以外の拡張子・0 フレーム・切り詰めデータ・非 PNG データを `400` で拒否し、ファイルを公開しないこと。
2. **Bridge 実エンコード**：30 フレーム（30fps）の PNG 列を `/save-frames` へ送信し、`ffprobe` で `codec=h264`, `width=1280`, `height=720`, `nb_frames=30`, `avg_frame_rate=30/1` の MP4 が公開されること。
3. **Client パック＆送信**：`packFrames` と `bridgeClient.uploadFrames` が正しいヘッダ・クエリ・バイナリ形式で送信すること。
4. **Capture 固定タイムステップ**：`renderAt` 指定＋ブリッジ利用可能時に `t = 0, 1/fps, ..., (N-1)/fps` の厳密な時刻列で `renderAt` が呼ばれ、完了・中断いずれでも `setFixedSize(null)` と `state = 'idle'` に復帰すること。
5. **フォールバック**：ブリッジ未接続時は既存の `MediaRecorder` パスで動作すること。
