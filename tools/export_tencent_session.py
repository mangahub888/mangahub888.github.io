#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Export Tencent Comic app session from LDPlayer.

Thin wrapper around quick_refresh_session.py so there is a single implementation.
No dummy/fake fallback values: exits with code 1 if no real session is found and
does not overwrite tools/tencent_app_session.json.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from quick_refresh_session import main  # noqa: E402

if __name__ == "__main__":
    main()
