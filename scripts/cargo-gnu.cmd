@echo off
setlocal
set "PATH=%~dp0..\target\protoc-29.3-win64\bin;%PATH%"
cargo +stable-x86_64-pc-windows-gnu %*
