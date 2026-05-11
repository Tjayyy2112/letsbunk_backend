async function testApi() {
  const API_URL = 'http://localhost:4000/api';
  
  try {
    let token = '';
    let res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@bunk.com', password: 'test', name: 'Test' })
    });
    let data = await res.json();
    if (!res.ok) {
      res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@bunk.com', password: 'test' })
      });
      data = await res.json();
    }
    token = data.token;

    const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    const subRes = await fetch(`${API_URL}/subjects`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ name: 'Test Sub' })
    });
    const subData = await subRes.json();
    const subjectId = subData.id;

    const markRes = await fetch(`${API_URL}/attendance`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({
        subjectId,
        date: '2026-05-11',
        status: 'PRESENT',
        periodIndex: 1
      })
    });
    const markData = await markRes.json();
    console.log('MARK RESPONSE STATUS:', markRes.status);
    console.log('MARK SUCCESS:', markData);

  } catch (err) {
    console.error('API ERROR:', err);
  }
}

testApi();
