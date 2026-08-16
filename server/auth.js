const jwt = require('jsonwebtoken');
require('dotenv').config();

function generateToken(user){
  const payload = { sub: user.id, tenant_id: user.tenant_id, role: user.role };
  return jwt.sign(payload, process.env.JWT_SECRET || 'replace_me', { expiresIn: '12h' });
}

function authMiddleware(req,res,next){
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ status:'error', pesan:'Unauthorized' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'replace_me');
    req.user = payload; next();
  } catch(e) { return res.status(401).json({ status:'error', pesan:'Invalid token' }); }
}

function requireRole(roles){
  return function(req,res,next){
    if (!req.user) return res.status(401).json({ status:'error', pesan:'Unauthorized' });
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ status:'error', pesan:'Forbidden' });
  };
}

module.exports = { generateToken, authMiddleware, requireRole };
