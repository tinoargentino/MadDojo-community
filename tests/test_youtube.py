from pathlib import Path

import pytest

from backend.youtube import youtube_url, validate_video, download_audio


@pytest.mark.parametrize('url', [
    'https://youtu.be/BaW_jenozKc?t=2',
    'https://www.youtube.com/watch?v=BaW_jenozKc&list=ignored',
    'https://music.youtube.com/watch?v=BaW_jenozKc',
    'https://youtube.com/shorts/BaW_jenozKc',
])
def test_youtube_urls_are_normalized_to_one_video(url):
    assert youtube_url(url) == 'https://www.youtube.com/watch?v=BaW_jenozKc'


@pytest.mark.parametrize('url', [
    'https://youtube.com.evil.test/watch?v=BaW_jenozKc',
    'https://youtube.com@127.0.0.1/watch?v=BaW_jenozKc',
    'file:///tmp/video', 'https://youtube.com/playlist?list=abc',
    'https://youtube.com:8767/watch?v=BaW_jenozKc',
    'https://youtu.be/not-an-id', 'http://127.0.0.1/',
])
def test_non_video_urls_are_rejected(url):
    with pytest.raises(ValueError): youtube_url(url)


@pytest.mark.parametrize('info', [{'is_live': True}, {'duration': 1201}, {'duration': None}, {'duration': 10, 'filesize': 1024**3}])
def test_limits_reject_live_long_or_oversized_videos(info):
    with pytest.raises(ValueError): validate_video(info)


def test_audio_download_uses_fixed_path_and_no_playlist(tmp_path, monkeypatch):
    import yt_dlp
    options = {}
    class Downloader:
        def __init__(self, opts): options.update(opts)
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def extract_info(self, url, download):
            if download: (tmp_path / 'source.wav').write_bytes(b'audio')
            return {'title': 'Practice song', 'duration': 10, 'is_live': False}
    monkeypatch.setattr(yt_dlp, 'YoutubeDL', Downloader)
    monkeypatch.setattr('backend.youtube.shutil.which', lambda name: '/usr/bin/' + name)
    result = download_audio('https://youtu.be/BaW_jenozKc', tmp_path)
    assert result['title'] == 'Practice song'
    assert options['noplaylist'] is True
    assert options['outtmpl'] == str(tmp_path / 'source.%(ext)s')
    assert options['postprocessors'][0]['preferredcodec'] == 'wav'
