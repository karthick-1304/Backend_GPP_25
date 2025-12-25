// backend/src/services/email.service.js

import { sendEmail } from '../utils/sendEmail.js';

const EMAIL_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #f8fafc; }
  .email-wrapper { background: #f8fafc; padding: 40px 20px; }
  .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.08); }
  .email-header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%); padding: 48px 40px; text-align: center; position: relative; overflow: hidden; }
  .email-header::before { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%); animation: pulse 3s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
  .email-header h1 { color: #ffffff; font-size: 32px; font-weight: 700; margin: 0; position: relative; z-index: 1; text-shadow: 0 2px 8px rgba(0,0,0,0.2); }
  .email-icon { font-size: 48px; margin-bottom: 16px; display: block; position: relative; z-index: 1; }
  .email-body { padding: 48px 40px; color: #1e293b; }
  .email-body h2 { color: #0f172a; font-size: 24px; font-weight: 600; margin-bottom: 24px; }
  .email-body p { color: #475569; font-size: 16px; line-height: 1.75; margin-bottom: 16px; }
  .otp-container { background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 3px solid #6366f1; border-radius: 16px; padding: 32px; text-align: center; margin: 32px 0; position: relative; overflow: hidden; }
  .otp-container::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #6366f1, #8b5cf6, #d946ef, #6366f1); }
  .otp-label { color: #64748b; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
  .otp-code { font-size: 48px; font-weight: 800; letter-spacing: 16px; color: #6366f1; font-family: 'Courier New', monospace; text-shadow: 2px 2px 8px rgba(99, 102, 241, 0.2); margin: 16px 0; }
  .otp-expiry { color: #64748b; font-size: 14px; margin-top: 16px; }
  .info-card { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-left: 4px solid #3b82f6; border-radius: 8px; padding: 20px 24px; margin: 24px 0; }
  .success-card { background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-left: 4px solid #22c55e; border-radius: 8px; padding: 20px 24px; margin: 24px 0; }
  .warning-card { background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%); border-left: 4px solid #f59e0b; border-radius: 8px; padding: 20px 24px; margin: 24px 0; }
  .danger-card { background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-left: 4px solid #ef4444; border-radius: 8px; padding: 20px 24px; margin: 24px 0; }
  .card-title { font-weight: 700; font-size: 16px; margin-bottom: 8px; }
  .info-card .card-title { color: #1e40af; }
  .success-card .card-title { color: #15803d; }
  .warning-card .card-title { color: #92400e; }
  .danger-card .card-title { color: #991b1b; }
  .card-text { margin: 0; font-size: 14px; line-height: 1.6; }
  .info-card .card-text { color: #1e40af; }
  .success-card .card-text { color: #15803d; }
  .warning-card .card-text { color: #92400e; }
  .danger-card .card-text { color: #991b1b; }
  .details-table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 24px 0; background: #f8fafc; border-radius: 12px; overflow: hidden; }
  .details-table tr { border-bottom: 1px solid #e2e8f0; }
  .details-table tr:last-child { border-bottom: none; }
  .details-table td { padding: 16px 20px; }
  .detail-label { font-weight: 600; color: #64748b; font-size: 14px; width: 160px; }
  .detail-value { color: #0f172a; font-size: 15px; font-weight: 500; }
  .action-button { display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 10px; font-weight: 600; font-size: 16px; margin: 24px 0; box-shadow: 0 4px 16px rgba(99, 102, 241, 0.4); transition: all 0.3s ease; }
  .action-button:hover { box-shadow: 0 6px 24px rgba(99, 102, 241, 0.6); transform: translateY(-2px); }
  .email-footer { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 32px 40px; text-align: center; color: #94a3b8; }
  .footer-brand { font-size: 20px; font-weight: 700; color: #ffffff; margin-bottom: 12px; }
  .footer-text { font-size: 13px; line-height: 1.6; margin: 8px 0; }
  .footer-link { color: #818cf8; text-decoration: none; }
  .footer-link:hover { color: #a5b4fc; }
  .divider { height: 1px; background: linear-gradient(90deg, transparent, #e2e8f0, transparent); margin: 32px 0; }
`;

// 1. OTP EMAIL
export const sendOTPEmail = async (email, fullName, otp) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><style>${EMAIL_STYLES}</style></head>
    <body>
      <div class="email-wrapper">
        <div class="email-container">
          <div class="email-header">
            <span class="email-icon">🔐</span>
            <h1>Password Reset Request</h1>
          </div>
          <div class="email-body">
            <h2>Hello ${fullName},</h2>
            <p>We received a request to reset your password for your GATE Preparation Portal account.</p>
            
            <div class="otp-container">
              <div class="otp-label">Your Verification Code</div>
              <div class="otp-code">${otp}</div>
              <div class="otp-expiry">⏱️ Valid for 10 minutes only</div>
            </div>

            <div class="danger-card">
              <div class="card-title">⚠️ Security Alert</div>
              <div class="card-text">If you didn't request this password reset, someone may be trying to access your account. Please ignore this email and consider changing your password immediately.</div>
            </div>

            <p>This verification code will expire in <strong>10 minutes</strong>. For your security, never share this code with anyone.</p>
          </div>
          <div class="email-footer">
            <div class="footer-brand">🎓 GATE Preparation Portal</div>
            <div class="footer-text">Secure Authentication System</div>
            <div class="footer-text">© 2025 NEC. All rights reserved.</div>
            <div class="footer-text">Need help? <a href="mailto:support@nec.edu.in" class="footer-link">Contact Support</a></div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    email,
    subject: '🔐 Password Reset OTP - GATE Portal',
    message: `Your OTP is ${otp}. Valid for 10 minutes.`,
    html
  });
};

// 2. PASSWORD CHANGED EMAIL
export const sendPasswordChangedEmail = async (email, fullName, ip, device) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><style>${EMAIL_STYLES}</style></head>
    <body>
      <div class="email-wrapper">
        <div class="email-container">
          <div class="email-header">
            <span class="email-icon">🔒</span>
            <h1>Password Changed</h1>
          </div>
          <div class="email-body">
            <h2>Hello ${fullName},</h2>
            
            <div class="success-card">
              <div class="card-title">✅ Password Updated Successfully</div>
              <div class="card-text">Your account password has been changed successfully. You can now use your new password to sign in.</div>
            </div>

            <p><strong>Security Details:</strong></p>
            <table class="details-table">
              <tr>
                <td class="detail-label">⏰ Time</td>
                <td class="detail-value">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'long' })}</td>
              </tr>
              <tr>
                <td class="detail-label">🌐 IP Address</td>
                <td class="detail-value">${ip}</td>
              </tr>
              <tr>
                <td class="detail-label">💻 Device</td>
                <td class="detail-value">${device}</td>
              </tr>
            </table>

            <div class="danger-card">
              <div class="card-title">⚠️ Didn't Make This Change?</div>
              <div class="card-text">If this wasn't you, your account may be compromised. Reset your password immediately and contact our admin team at <a href="mailto:admin@nec.edu.in">admin@nec.edu.in</a></div>
            </div>
          </div>
          <div class="email-footer">
            <div class="footer-brand">🎓 GATE Preparation Portal</div>
            <div class="footer-text">Account Security Team</div>
            <div class="footer-text">© 2025 NEC. All rights reserved.</div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    email,
    subject: '🔒 Password Changed Successfully - GATE Portal',
    message: `Your password was changed from IP: ${ip}`,
    html
  });
};

  // 3. SUBJECT CREATED EMAIL
  export const sendSubjectCreatedEmail = async (recipients, subjectName, subjectId, creatorName, addedDepts = []) => {
    const deptsText = addedDepts.length > 0 
      ? `<p>The following departments have been granted access:</p><ul style="list-style: none; padding-left: 0;">${addedDepts.map(d => `<li style="padding: 8px 0;">✓ ${d.dept_name} </li>`).join('')}</ul>`
      : '';

    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><style>${EMAIL_STYLES}</style></head>
      <body>
        <div class="email-wrapper">
          <div class="email-container">
            <div class="email-header">
              <span class="email-icon">📚</span>
              <h1>New Subject Created</h1>
            </div>
            <div class="email-body">
              <h2>New Subject Available!</h2>
              
              <div class="success-card">
                <div class="card-title">✅ "${subjectName}" is now live</div>
                <div class="card-text">A new subject has been created by ${creatorName}.</div>
              </div>

              <table class="details-table">
                <tr>
                  <td class="detail-label">📌 Subject</td>
                  <td class="detail-value">${subjectName}</td>
                </tr>
                <tr>
                  <td class="detail-label">🆔 Subject ID</td>
                  <td class="detail-value">#${subjectId}</td>
                </tr>
                <tr>
                  <td class="detail-label">👤 Created By</td>
                  <td class="detail-value">${creatorName}</td>
                </tr>
                <tr>
                  <td class="detail-label">📅 Created On</td>
                  <td class="detail-value">${new Date().toLocaleString('en-IN')}</td>
                </tr>
              </table>

              ${deptsText}

              <p>You can now access this subject and start exploring its topics and practice sets.</p>
            </div>
            <div class="email-footer">
              <div class="footer-brand">🎓 GATE Preparation Portal</div>
              <div class="footer-text">© 2025 NEC. All rights reserved.</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    for (const recipient of recipients) {
      await sendEmail({
        email: recipient.email,
        subject: '📚 New Subject Created - GATE Portal',
        message: `New subject "${subjectName}" created by ${creatorName}`,
        html
      });
    }
  };

  // 4. TOPIC CREATED EMAIL
  export const sendTopicCreatedEmail = async (recipients, topicName, subjectName, creatorName) => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><style>${EMAIL_STYLES}</style></head>
      <body>
        <div class="email-wrapper">
          <div class="email-container">
            <div class="email-header">
              <span class="email-icon">📖</span>
              <h1>New Topic Added</h1>
            </div>
            <div class="email-body">
              <h2>New Topic !! More Learnings !!</h2>
              
              <div class="success-card">
                <div class="card-title">✅ New Topic: "${topicName}"</div>
                <div class="card-text">A new topic has been added to "${subjectName}" by ${creatorName}.</div>
              </div>

              <table class="details-table">
                <tr>
                  <td class="detail-label">📚 Subject</td>
                  <td class="detail-value">${subjectName}</td>
                </tr>
                <tr>
                  <td class="detail-label">📖 Topic</td>
                  <td class="detail-value">${topicName}</td>
                </tr>
                <tr>
                  <td class="detail-label">👤 Created By</td>
                  <td class="detail-value">${creatorName} </td>
                </tr>
                <tr>
                  <td class="detail-label">📅 Created On</td>
                  <td class="detail-value">${new Date().toLocaleString('en-IN')}</td>
                </tr>
              </table>

              <p>Start practicing with the new topic now!</p>
            </div>
            <div class="email-footer">
              <div class="footer-brand">🎓 GATE Preparation Portal</div>
              <div class="footer-text">© 2025 NEC. All rights reserved.</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    for (const recipient of recipients) {
      await sendEmail({
        email: recipient.email,
        subject: '📖 New Topic Added - GATE Portal',
        message: `New topic "${topicName}" added to ${subjectName}`,
        html
      });
    }
  };

  // 5. PRACTICE SET CREATED EMAIL
  export const sendSetCreatedEmail = async (recipients, level, topicName, subjectName, questionsCount, creatorName, creatorDept) => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><style>${EMAIL_STYLES}</style></head>
      <body>
        <div class="email-wrapper">
          <div class="email-container">
            <div class="email-header">
              <span class="email-icon">✍️</span>
              <h1>New Practice Set</h1>
            </div>
            <div class="email-body">
              <h2>Time to Practice!</h2>
              
              <div class="success-card">
                <div class="card-title">✅ Level ${level} Practice Set Added</div>
                <div class="card-text">A new practice set has been created for "${topicName}" by ${creatorName} from ${creatorDept}.</div>
              </div>

              <table class="details-table">
                <tr>
                  <td class="detail-label">📚 Subject</td>
                  <td class="detail-value">${subjectName}</td>
                </tr>
                <tr>
                  <td class="detail-label">📖 Topic</td>
                  <td class="detail-value">${topicName}</td>
                </tr>
                <tr>
                  <td class="detail-label">🎯 Level</td>
                  <td class="detail-value">Level ${level}</td>
                </tr>
                <tr>
                  <td class="detail-label">❓ Questions</td>
                  <td class="detail-value">${questionsCount} questions</td>
                </tr>
                <tr>
                  <td class="detail-label">👤 Created By</td>
                  <td class="detail-value">${creatorName} </td>
                </tr>
              </table>

              <p>Challenge yourself with the new practice questions!</p>
            </div>
            <div class="email-footer">
              <div class="footer-brand">🎓 GATE Preparation Portal</div>
              <div class="footer-text">© 2025 NEC. All rights reserved.</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    for (const recipient of recipients) {
      await sendEmail({
        email: recipient.email,
        subject: '✍️ New Practice Set Available - GATE Portal',
        message: `Level ${level} practice set added to ${topicName}`,
        html
      });
    }
  };

  // 6. SUBJECT LOCK TOGGLE - DEPT HEADS
  export const sendSubjectLockToDeptHeads = async (recipients, subjectName, isLocked, lockerName) => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><style>${EMAIL_STYLES}</style></head>
      <body>
        <div class="email-wrapper">
          <div class="email-container">
            <div class="email-header">
              <span class="email-icon">${isLocked ? '🔒' : '🔓'}</span>
              <h1>Subject ${isLocked ? 'Locked' : 'Unlocked'}</h1>
            </div>
            <div class="email-body">
              <h2>Subject Access Update</h2>
              
              <div class="${isLocked ? 'warning-card' : 'success-card'}">
                <div class="card-title">${isLocked ? '🔒' : '✅'} "${subjectName}" ${isLocked ? 'Locked' : 'Unlocked'}</div>
                <div class="card-text">${lockerName} has ${isLocked ? 'locked' : 'unlocked'} this subject ${isLocked ? 'for maintenance' : 'and it is now accessible'}.</div>
              </div>

              <table class="details-table">
                <tr>
                  <td class="detail-label">📚 Subject</td>
                  <td class="detail-value">${subjectName}</td>
                </tr>
                <tr>
                  <td class="detail-label">🔑 Status</td>
                  <td class="detail-value">${isLocked ? 'Locked 🔒' : 'Active 🔓'}</td>
                </tr>
                <tr>
                  <td class="detail-label">👤 Action By</td>
                  <td class="detail-value">${lockerName} </td>
                </tr>
                <tr>
                  <td class="detail-label">⏰ Time</td>
                  <td class="detail-value">${new Date().toLocaleString('en-IN')}</td>
                </tr>
              </table>

              <p>${isLocked 
                ? 'Students and staff from all departments cannot access this subject until it is unlocked.' 
                : 'All departments can now access this subject again.'}</p>
            </div>
            <div class="email-footer">
              <div class="footer-brand">🎓 GATE Preparation Portal</div>
              <div class="footer-text">© 2025 NEC. All rights reserved.</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    for (const recipient of recipients) {
      await sendEmail({
        email: recipient.email,
        subject: `${isLocked ? '🔒' : '🔓'} Subject ${isLocked ? 'Locked' : 'Unlocked'} - GATE Portal`,
        message: `"${subjectName}" has been ${isLocked ? 'locked' : 'unlocked'}`,
        html
      });
    }
  };

  // 7. SUBJECT LOCK TOGGLE - ALL PARTICIPANTS
  export const sendSubjectLockToParticipants = async (recipients, subjectName, isLocked) => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><style>${EMAIL_STYLES}</style></head>
      <body>
        <div class="email-wrapper">
          <div class="email-container">
            <div class="email-header">
              <span class="email-icon">${isLocked ? '🔒' : '🔓'}</span>
              <h1>Subject ${isLocked ? 'Under Maintenance' : 'Now Available'}</h1>
            </div>
            <div class="email-body">
              <h2>Subject Access Update</h2>
              
              <div class="${isLocked ? 'warning-card' : 'success-card'}">
                <div class="card-title">${isLocked ? '🔒 Temporarily Unavailable' : '✅ Now Accessible'}</div>
                <div class="card-text">The subject "${subjectName}" is ${isLocked ? 'currently locked for maintenance and updates' : 'now available for practice'}.</div>
              </div>

              <p>${isLocked 
                ? 'We apologize for any inconvenience. The subject will be available again soon.' 
                : 'You can now access all topics and practice sets in this subject.'}</p>
            </div>
            <div class="email-footer">
              <div class="footer-brand">🎓 GATE Preparation Portal</div>
              <div class="footer-text">© 2025 NEC. All rights reserved.</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    for (const recipient of recipients) {
      await sendEmail({
        email: recipient.email,
        subject: `${isLocked ? '🔒 Subject Maintenance' : '🔓 Subject Available'} - GATE Portal`,
        message: `"${subjectName}" is ${isLocked ? 'under maintenance' : 'now available'}`,
        html
      });
    }
  };

  // 8. DEPT SUBJECT LOCK - PARTICIPANTS
  export const sendDeptSubLockToParticipants = async (recipients, subjectName, deptName, isLocked) => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><style>${EMAIL_STYLES}</style></head>
      <body>
        <div class="email-wrapper">
          <div class="email-container">
            <div class="email-header">
              <span class="email-icon">${isLocked ? '🔒' : '🔓'}</span>
              <h1>Department Access ${isLocked ? 'Restricted' : 'Granted'}</h1>
            </div>
            <div class="email-body">
              <h2>Subject Access Update</h2>
              
              <div class="${isLocked ? 'warning-card' : 'success-card'}">
                <div class="card-title">${isLocked ? '🔒 Access Restricted' : '✅ Access Granted'}</div>
                <div class="card-text">Access to "${subjectName}" has been ${isLocked ? 'temporarily restricted' : 'restored'} for ${deptName} department.</div>
              </div>

              <table class="details-table">
                <tr>
                  <td class="detail-label">📚 Subject</td>
                  <td class="detail-value">${subjectName}</td>
                </tr>
                <tr>
                  <td class="detail-label">🏛️ Department</td>
                  <td class="detail-value">${deptName}</td>
                </tr>
                <tr>
                  <td class="detail-label">🔑 Status</td>
                  <td class="detail-value">${isLocked ? 'Locked (Dept Level) 🔒' : 'Active 🔓'}</td>
                </tr>
                <tr>
                  <td class="detail-label">⏰ Time</td>
                  <td class="detail-value">${new Date().toLocaleString('en-IN')}</td>
                </tr>
              </table>

              <p>${isLocked 
                ? 'This subject is temporarily unavailable for your department. It will be accessible again soon.' 
                : 'You can now access this subject and all its content.'}</p>
            </div>
            <div class="email-footer">
              <div class="footer-brand">🎓 GATE Preparation Portal</div>
              <div class="footer-text">© 2025 NEC. All rights reserved.</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    for (const recipient of recipients) {
      await sendEmail({
        email: recipient.email,
        subject: `${isLocked ? '🔒 Access Restricted' : '🔓 Access Granted'} - GATE Portal`,
        message: `${deptName} access to "${subjectName}" ${isLocked ? 'restricted' : 'granted'}`,
        html
      });
    }
  };

  // 9. DEPARTMENT ADDED TO SUBJECT
  export const sendDeptAddedToSubject = async (recipients, subjectName, deptName, adderName) => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><style>${EMAIL_STYLES}</style></head>
      <body>
        <div class="email-wrapper">
          <div class="email-container">
            <div class="email-header">
              <span class="email-icon">✅</span>
              <h1>Subject Access Granted</h1>
            </div>
            <div class="email-body">
              <h2>Subject Access Granted!</h2>
              
              <div class="success-card">
                <div class="card-title">✅ Access Granted to "${subjectName}"</div>
                <div class="card-text">Your department "${deptName}" has been granted access to this subject by ${adderName}.</div>
              </div>

              <table class="details-table">
                <tr>
                  <td class="detail-label">📚 Subject</td>
                  <td class="detail-value">${subjectName}</td>
                </tr>
                <tr>
                  <td class="detail-label">🏛️ Your Department</td>
                  <td class="detail-value">${deptName}</td>
                </tr>
                <tr>
                  <td class="detail-label">👤 Granted By</td>
                  <td class="detail-value">${adderName} </td>
                </tr>
                <tr>
                  <td class="detail-label">⏰ Time</td>
                  <td class="detail-value">${new Date().toLocaleString('en-IN')}</td>
                </tr>
              </table>

              <p>You can now access all topics and practice sets in this subject. Start preparing today!</p>
            </div>
            <div class="email-footer">
              <div class="footer-brand">🎓 GATE Preparation Portal</div>
              <div class="footer-text">© 2025 NEC. All rights reserved.</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    for (const recipient of recipients) {
      await sendEmail({
        email: recipient.email,
        subject: '✅ Subject Access Granted - GATE Portal',
        message: `${deptName} granted access to "${subjectName}"`,
        html
      });
    }
  };
  


// 10. DEPARTMENT REMOVED FROM SUBJECT (FIXED)
export const sendDeptRemovedFromSubject = async (recipients, subjectName, deptName, removerName) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><style>${EMAIL_STYLES}</style></head>
    <body>
      <div class="email-wrapper">
        <div class="email-container">
          <div class="email-header">
            <span class="email-icon">⚠️</span>
            <h1>Subject Access Removed</h1>
          </div>
          <div class="email-body">
            <h2>Access Update Notice</h2>
            
            <div class="warning-card">
              <div class="card-title">⚠️ Access Removed from "${subjectName}"</div>
              <div class="card-text">Your department "${deptName}" no longer has access to this subject. This change was made by ${removerName} .</div>
            </div>

            <table class="details-table">
              <tr>
                <td class="detail-label">📚 Subject</td>
                <td class="detail-value">${subjectName}</td>
              </tr>
              <tr>
                <td class="detail-label">🏛️ Your Department</td>
                <td class="detail-value">${deptName}</td>
              </tr>
              <tr>
                <td class="detail-label">👤 Removed By</td>
                <td class="detail-value">${removerName} </td>
              </tr>
              <tr>
                <td class="detail-label">⏰ Time</td>
                <td class="detail-value">${new Date().toLocaleString('en-IN')}</td>
              </tr>
            </table>

            <p>If you believe this is an error, please contact the subject administrator.</p>
          </div>
          <div class="email-footer">
            <div class="footer-brand">🎓 GATE Preparation Portal</div>
            <div class="footer-text">© 2025 NEC. All rights reserved.</div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  for (const recipient of recipients) {
    await sendEmail({
      email: recipient.email,
      subject: '⚠️ Subject Access Removed - GATE Portal',
      message: `${deptName} access removed from "${subjectName}"`,
      html
    });
  }
};

// 11. SUBJECT ACCESS REQUEST (FIXED)
export const sendSubjectAccessRequestEmail = async (
  creatorEmail, 
  creatorName, 
  requesterName, 
  requesterEmail,
  deptName,
  deptCode,
  subjectName,
  subjectId
) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><style>${EMAIL_STYLES}</style></head>
    <body>
      <div class="email-wrapper">
        <div class="email-container">
          <div class="email-header">
            <span class="email-icon">📬</span>
            <h1>Subject Access Request</h1>
          </div>
          <div class="email-body">
            <h2>Hello ${creatorName},</h2>
            
            <div class="info-card">
              <div class="card-title">📬 New Access Request</div>
              <div class="card-text">${deptName} has requested access to your subject "${subjectName}".</div>
            </div>

            <table class="details-table">
              <tr>
                <td class="detail-label">👤 Requester</td>
                <td class="detail-value">${requesterName}</td>
              </tr>
              <tr>
                <td class="detail-label">📧 Email</td>
                <td class="detail-value">${requesterEmail}</td>
              </tr>
              <tr>
                <td class="detail-label">🏛️ Department</td>
                <td class="detail-value">${deptName} </td>
              </tr>
              <tr>
                <td class="detail-label">📚 Subject</td>
                <td class="detail-value">${subjectName}</td>
              </tr>
              <tr>
                <td class="detail-label">⏰ Request Time</td>
                <td class="detail-value">${new Date().toLocaleString('en-IN')}</td>
              </tr>
            </table>

            <p>Please review this request and decide whether to grant access to ${deptName} department. You can approve or deny this request from the subject management panel.</p>
          </div>
          <div class="email-footer">
            <div class="footer-brand">🎓 GATE Preparation Portal</div>
            <div class="footer-text">© 2025 NEC. All rights reserved.</div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    email: creatorEmail,
    subject: '📬 Subject Access Request - GATE Portal',
    message: `${requesterName} from ${deptName} requested access to "${subjectName}"`,
    html
  });
};
