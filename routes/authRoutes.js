// routes/authRoutes.js
const express = require('express');
const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const router = express.Router();

router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    const error = req.session.loginError;
    delete req.session.loginError;
    res.render('login', { error: error, pageTitle: 'Admin Login' });
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await query('SELECT id, name, hashed_password FROM people WHERE name = $1 AND is_admin = TRUE', [username]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (!user.hashed_password) {
                console.warn(`[WEB_AUTH] Login failed: User ${username} is admin but has no password hash set.`);
                req.session.loginError = 'Admin account not properly configured.';
                return res.redirect('/login');
            }
            const match = await bcrypt.compare(password, user.hashed_password);
            if (match) {
                req.session.regenerate(function(err) {
                    if (err) {
                        console.error('[WEB_AUTH] Error regenerating session:', err);
                        req.session.loginError = 'Session error. Please try again.';
                        return res.redirect('/login');
                    }
                    req.session.user = { id: user.id, name: user.name, isAdmin: true };
                    req.session.save((saveErr) => {
                        if (saveErr) {
                            console.error('[WEB_AUTH] Error saving session before redirect:', saveErr);
                            req.session.loginError = 'Session save error. Please try again.';
                            return res.redirect('/login');
                        }
                        console.log(`[WEB_AUTH] User ${user.name} logged in successfully. Redirecting to /`);
                        return res.redirect('/');
                    });
                });
            } else {
                console.warn(`[WEB_AUTH] Password mismatch for admin username: ${username}`);
                req.session.loginError = 'Invalid username or password.';
                res.redirect('/login');
            }
        } else {
            console.warn(`[WEB_AUTH] Login failed: User ${username} not found or not admin.`);
            req.session.loginError = 'Invalid username or password, or not an admin.';
            res.redirect('/login');
        }
    } catch (error) {
        console.error('[WEB_AUTH] Critical error during login process:', error);
        req.session.loginError = 'A server error occurred during login.';
        res.redirect('/login');
    }
});

router.get('/logout', (req, res, next) => {
    req.session.user = null;
    req.session.save(function(err) {
        if (err) { console.error('[WEB_AUTH] Error saving session on logout:', err); return next(err); }
        req.session.destroy(err => {
            if (err) { console.error('[WEB_AUTH] Error destroying session:', err); return next(err); }
            console.log('[WEB_AUTH] User logged out and session destroyed.');
            res.redirect('/login');
        });
    });
});

module.exports = router;