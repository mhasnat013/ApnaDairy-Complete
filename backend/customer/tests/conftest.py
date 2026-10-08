# ApnaDairy B2C — shared pytest fixtures.
#
# THE test-only environment. pytest imports this file BEFORE collecting any
# test module, so these values are set before app.main / app.core / app.db
# are imported for the first time. Never put real secrets here — everything
# is a dummy test value.
import os

os.environ["SUPABASE_MOBILE_URL"] = "https://test-mobile.supabase.co"
os.environ["SUPABASE_MOBILE_SERVICE_KEY"] = "test-mobile-key"
os.environ["SUPABASE_MOBILE_ANON_KEY"] = "test-mobile-anon-key"
os.environ["SUPABASE_WEB_URL"] = "https://test-web.supabase.co"
os.environ["SUPABASE_WEB_SERVICE_KEY"] = "test-web-key"
os.environ["AUTH_DEMO_ENABLED"] = "false"
os.environ["STAFF_API_KEY"] = "test-staff-key"
os.environ["DEMO_CUSTOMER_ID"] = "00000000-0000-0000-0000-000000000001"
os.environ["PAYMENTS_TEST_MODE"] = "true"

import pytest  # noqa: E402

from app.core import security  # noqa: E402
from app.db import supabase_client  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_state():
    """Drop cached JWKS and Supabase clients between tests."""
    security.reset_jwks_cache()
    supabase_client.reset_clients()
    yield
    security.reset_jwks_cache()
    supabase_client.reset_clients()
