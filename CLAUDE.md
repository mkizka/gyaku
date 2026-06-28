## このプロジェクトについて

`@gyaku/di` は TypeScript 向けの軽量 DI ライブラリ。

## リポジトリ構成

- examples/
  - startコマンドで実行可能な実装例
- packages/gyaku
  - ライブラリ実装本体
- web/
  - GitHub Pagesを使用した紹介ページ

## バージョン更新方法

packages/gyaku/package.jsonのバージョンを変更するだけでCIが新しいバージョンをpublishするようになっている。

バージョン更新時は前回のバージョン更新コミットとのgit diffを確認し、適切なsemverを決定すること。

## 変更後の検証

実装の変更後は以下のコマンドを実行して検証を行うこと。

```sh
pnpm all
```
