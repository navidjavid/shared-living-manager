// routes/authRoutes.js
// Handles web authentication routes (/login, /logout).

const express = require('express');
const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const router = express.Router();

router.get('/login', (req, res) => {
    if (req.session.user) { // If already logged in, redirect to dashboard
        return res.redirect('/');
    }
    const error = req.session.loginError;
    delete req.session.loginError; // Clear error after displaying it once
    res.render('login', { error: error, pageTitle: 'Admin Login' });
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`[WEB_AUTH] Login attempt for username: ${username}`);
    try {
        const result = await query('SELECT id, name, hashed_password FROM people WHERE name = $1 AND is_admin = TRUE', [username]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (!user.hashed_password) {
                console.log(`[WEB_AUTH] Login failed: User ${username} is admin but has no password hash set.`);
                req.session.loginError = 'Admin account not fully configured. Please contact support.';
                return res.redirect('/login');
            }
            const match = await bcrypt.compare(password, user.hashed_password);
            if (match) {
                // Regenerate session to prevent session fixation
                req.session.regenerate(function(err) {
                    if (err) {
                        console.error('[WEB_AUTH] Error regenerating session:', err);
                        req.session.loginError = 'Session error. Please try again.';
                        return res.redirect('/login');
                    }
                    // Store user information in session
                    req.session.user = { id: user.id, name: user.name, isAdmin: true };
                    console.log(`[WEB_AUTH] User ${user.name} logged in successfully. Session user set.`);
                    
                    // Explicitly save session before redirect
                    req.session.save((err) => {
                        if (err) {
                            console.error('[WEB_AUTH] Error saving session before redirect:', err);
                            req.session.loginError = 'Session save error. Please try again.';
                            return res.redirect('/login');
                        }
                        console.log('[WEB_AUTH] Session saved. Redirecting to /');
                        return res.redirect('/');
                    });
                });
            } else {
                console.log(`[WEB_AUTH] Password mismatch for admin username: ${username}`);
                req.session.loginError = 'Invalid username or password.';
                res.redirect('/login');
            }
        } else {
            console.log(`[WEB_AUTH] Login failed for username: ${username} (user not found or not admin).`);
            req.session.loginError = 'Invalid username or password, or not an admin.';
            res.redirect('/login');
        }
    } catch (error) {
        console.error('[WEB_AUTH] Error during login process:', error);
        req.session.loginError = 'An server error occurred during login. Please try again.';
        res.redirect('/login');
    }
});

router.get('/logout', (req, res, next) => {
    req.session.user = null; // Clear the user object
    req.session.save(function(err) { // Save changes to session store
        if (err) {
            console.error('[WEB_AUTH] Error saving session on logout:', err);
            return next(err); // Pass error to error handler
        }
        req.session.destroy(err => { // Destroy the session
            if (err) {
                console.error('[WEB_AUTH] Error destroying session:', err);
                return next(err);
            }
            console.log('[WEB_AUTH] User logged out and session destroyed.');
            res.redirect('/login');
        });
    });
});

module.exports = router;