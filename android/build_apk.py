#!/usr/bin/env python3
"""Build the dependency-free APK with official Android SDK tools (no Gradle download)."""
import argparse
import os
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sdk', default=os.environ.get('ANDROID_HOME'))
    parser.add_argument('--jdk', default=os.environ.get('JAVA_HOME'))
    parser.add_argument('--keystore', type=Path)
    parser.add_argument('--password-file', type=Path)
    args = parser.parse_args()
    if not args.sdk or not args.jdk:
        parser.error('Set ANDROID_HOME/JAVA_HOME or use --sdk/--jdk.')
    if bool(args.keystore) != bool(args.password_file):
        parser.error('--keystore and --password-file must be supplied together.')
    sdk, jdk = Path(args.sdk), Path(args.jdk)
    bt = sdk / 'build-tools' / '35.0.0'
    platform = sdk / 'platforms' / 'android-35' / 'android.jar'
    out = ROOT / 'app' / 'build' / 'manual'
    for name in ['classes', 'dex', 'generated']:
        (out / name).mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, JAVA_HOME=str(jdk))

    def run(*command):
        subprocess.run([str(x) for x in command], check=True, env=env)

    def executable(base, name, batch=False):
        suffix = ('.bat' if batch else '.exe') if os.name == 'nt' else ''
        return base / (name + suffix)

    source = ROOT / 'app' / 'src' / 'main'
    manifest = ET.parse(source / 'AndroidManifest.xml')
    ET.register_namespace('android', 'http://schemas.android.com/apk/res/android')
    manifest.getroot().set('package', 'io.github.flowergorge.moadoogi')
    manifest.write(out / 'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
    aapt2 = executable(bt, 'aapt2')
    run(aapt2, 'compile', '--dir', source / 'res', '-o', out / 'resources.zip')
    run(aapt2, 'link', '-o', out / 'resources.apk', '-I', platform,
        '--manifest', out / 'AndroidManifest.xml', '--java', out / 'generated',
        '--min-sdk-version', '26', '--target-sdk-version', '35',
        '--version-code', '2', '--version-name', '1.1.0', out / 'resources.zip')
    sources = sorted((source / 'java').rglob('*.java')) + sorted((out / 'generated').rglob('*.java'))
    javac = executable(jdk / 'bin', 'javac')
    compiler = [javac] if javac.exists() else [executable(jdk / 'bin', 'java'), '-m', 'jdk.compiler/com.sun.tools.javac.Main']
    run(*compiler, '-encoding', 'UTF-8', '-source', '8', '-target', '8',
        '-classpath', platform, '-d', out / 'classes', *sources)
    with zipfile.ZipFile(out / 'classes.jar', 'w') as jar:
        for path in sorted((out / 'classes').rglob('*.class')):
            jar.write(path, path.relative_to(out / 'classes').as_posix())
    run(executable(bt, 'd8', True), '--release', '--min-api', '26', '--lib', platform,
        '--output', out / 'dex', out / 'classes.jar')
    raw = out / 'moadoogi-unaligned.apk'
    raw.write_bytes((out / 'resources.apk').read_bytes())
    with zipfile.ZipFile(raw, 'a', zipfile.ZIP_DEFLATED) as apk:
        apk.write(out / 'dex' / 'classes.dex', 'classes.dex')
    aligned = out / 'moadoogi-unsigned.apk'
    run(executable(bt, 'zipalign'), '-f', '-p', '4', raw, aligned)
    if args.keystore:
        final = out / 'moadoogi-share-v1.1.0.apk'
        signer = executable(bt, 'apksigner', True)
        run(signer, 'sign', '--ks', args.keystore.resolve(), '--ks-key-alias', 'moadoogi',
            '--ks-pass', 'file:' + str(args.password_file.resolve()), '--out', final, aligned)
        run(signer, 'verify', '--verbose', final)
    else:
        final = aligned
    print('APK:', final)


if __name__ == '__main__':
    main()
