// backend/src/utils/sendEmail.js
import nodemailer from 'nodemailer';

export const sendEmail = async (options) => {
  let transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

  const mailOptions = {
    from: '"Proj Testing, not serious (Under Testing) - GATE Portal" <no-reply@gateportal.com>',
    to: '2212076@nec.edu.in',
    subject: options.subject,
    text: options.message,
    html: options.html,
  };

  const info = await transporter.sendMail(mailOptions);

  // This prints the link where you can see the email
  if (process.env.NODE_ENV !== 'production') {
    console.log('OTP Email sent!');
    console.log('Preview URL →', nodemailer.getTestMessageUrl(info));
  }

  return info;
};