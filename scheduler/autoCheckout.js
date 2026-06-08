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
  cron.schedule('0 12 * * 1-5', () => {
    autoCheckoutPeriod('morning', 'Mon-Fri 12:00 morning');
  });

  cron.schedule('0 12 * * 1-5', () => {
    autoCheckoutPeriod('evening', 'Mon-Fri 12:00 evening (TEST)');
  });

  console.log('Auto checkout scheduler started (morning 12:00, evening 12:00 TEST MODE)');
}

module.exports = { startAutoCheckoutScheduler };
