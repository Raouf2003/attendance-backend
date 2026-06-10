const cron = require('node-cron');
const Attendance = require('../models/Attendance');

async function autoCheckoutPeriod(period, label) {
  try {
    const dateKey = new Date().toISOString().split('T')[0];

    const result = await Attendance.updateMany(
      {
        date: dateKey,
        period: period,
        checkOutTime: null,
      },
      [
        {
          $set: {
            checkOutTime: new Date(),
            totalMinutes: {
              $round: [
                {
                  $divide: [
                    { $subtract: [new Date(), '$checkInTime'] },
                    60000,
                  ],
                },
                0,
              ],
            },
            autoCheckout: true,
          },
        },
      ]
    );

    if (result.modifiedCount > 0) {
      console.log(`Auto checked out ${result.modifiedCount} employees (${label})`);
    }
  } catch (error) {
    console.error(`Auto checkout error (${label}):`, error);
  }
}

function startAutoCheckoutScheduler() {
  cron.schedule('0 10 * * 1-5', () => {
    autoCheckoutPeriod('morning', 'Mon-Fri 10:00 morning');
  });

  cron.schedule('0 11 * * 1-5', () => {
    autoCheckoutPeriod('morning', 'Mon-Fri 11:00 morning');
  });

  cron.schedule('0 14 * * 1-5', () => {
    autoCheckoutPeriod('evening', 'Mon-Fri 14:00 evening');
  });

  cron.schedule('0 15 * * 1-5', () => {
    autoCheckoutPeriod('evening', 'Mon-Fri 15:00 evening');
  });

  cron.schedule('30 10 * * 0,6', () => {
    autoCheckoutPeriod('morning', 'Weekend 10:30 morning');
  });

  cron.schedule('30 11 * * 0,6', () => {
    autoCheckoutPeriod('morning', 'Weekend 11:30 morning');
  });

  cron.schedule('0 14 * * 0,6', () => {
    autoCheckoutPeriod('evening', 'Weekend 14:00 evening');
  });

  cron.schedule('0 15 * * 0,6', () => {
    autoCheckoutPeriod('evening', 'Weekend 15:00 evening');
  });

  console.log('Auto checkout scheduler started (10:00/11:00 morning, 14:00/15:00 evening UTC)');
}

module.exports = { startAutoCheckoutScheduler };
