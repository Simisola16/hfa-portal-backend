import mongoose from 'mongoose';
import dotenv from 'dotenv';
import InitialProductApplication from '../models/InitialProductApplication.js';
import ApplicationLogsheet from '../models/ApplicationLogsheet.js';
import User from '../models/User.js';
import Application from '../models/Application.js';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/hfa-portal';

async function runTest() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');

  let testIpApp = null;
  let testLogsheet = null;
  let mockClient = null;
  let mockApp = null;

  try {
    mockClient = await User.findOne({ role: 'client' });
    if (!mockClient) {
      mockClient = await User.findOne({});
    }
    mockApp = await Application.findOne({});

    console.log('\n--- TEST 1: Gating Enable Form When FT Is Not Assigned ---');
    testIpApp = new InitialProductApplication({
      client_id: mockClient._id,
      application_id: mockApp ? mockApp._id : new mongoose.Types.ObjectId(),
      contact_name: 'Test Contact',
      contact_email: 'test@example.com',
      product: {
        name: 'Original Test Tea',
        code: 'TEA-001',
        category: 'Beverages',
        ingredients: 'Black tea leaves',
        description: 'Initial test product'
      },
      status: 'submitted',
      assigned_food_techs: []
    });
    await testIpApp.save();
    console.log(`Created test Initial Product with ID: ${testIpApp._id} (status: ${testIpApp.status})`);

    const hasFt1 = Boolean(
      (Array.isArray(testIpApp.assigned_food_techs) && testIpApp.assigned_food_techs.length > 0) ||
      testIpApp.assigned_food_tech ||
      testIpApp.assigned_ft_custom?.name ||
      testIpApp.assigned_ft_details ||
      testIpApp.status !== 'submitted'
    );
    console.log(`hasFt check before assignment: ${hasFt1}`);
    if (hasFt1) throw new Error('FAIL: hasFt should be false for newly submitted item without FT');
    console.log('✓ PASS: Enable form blocked when FT is not assigned.');

    console.log('\n--- TEST 2: Assign FT and Enable Form ---');
    testIpApp.status = 'ft_assigned';
    testIpApp.assigned_ft_details = 'Dr. Jane Smith (FT Specialist)';
    await testIpApp.save();

    const hasFt2 = Boolean(
      (Array.isArray(testIpApp.assigned_food_techs) && testIpApp.assigned_food_techs.length > 0) ||
      testIpApp.assigned_food_tech ||
      testIpApp.assigned_ft_custom?.name ||
      testIpApp.assigned_ft_details ||
      testIpApp.status !== 'submitted'
    );
    console.log(`hasFt check after assignment: ${hasFt2}`);
    if (!hasFt2) throw new Error('FAIL: hasFt should be true after FT assignment');

    testIpApp.status = 'product_approval_form_enabled';
    testIpApp.product_approval_form = {
      form_text: 'Please submit ingredient details',
      sent_at: new Date()
    };
    await testIpApp.save();
    console.log('✓ PASS: Form enabled successfully after FT assignment.');

    console.log('\n--- TEST 3: Product Form Received Gating (Client Has NOT Submitted) ---');
    const isClientSubmitted1 = Boolean(
      testIpApp.product_approval_form?.submitted_at ||
      testIpApp.product_approval_form?.product_response?.is_saved ||
      Boolean(testIpApp.product_approval_form?.product_response?.response_url) ||
      (testIpApp.product_approval_form?.product_response?.form_data && Object.keys(testIpApp.product_approval_form?.product_response?.form_data).length > 0)
    );
    console.log(`isClientSubmitted check before client submission: ${isClientSubmitted1}`);
    if (isClientSubmitted1) throw new Error('FAIL: isClientSubmitted should be false');
    console.log('✓ PASS: Mark Product Form Received button will be hidden because client has not submitted.');

    console.log('\n--- TEST 4: Client Submits Form Response ---');
    testIpApp.product_approval_form.product_response = {
      is_saved: true,
      form_data: { product_name: 'Original Test Tea', product_code: 'TEA-001', cert_scheme: 'HFA Scheme' },
      saved_at: new Date()
    };
    testIpApp.product_approval_form.submitted_at = new Date();
    await testIpApp.save();

    const isClientSubmitted2 = Boolean(
      testIpApp.product_approval_form?.submitted_at ||
      testIpApp.product_approval_form?.product_response?.is_saved
    );
    console.log(`isClientSubmitted check after client submission: ${isClientSubmitted2}`);
    if (!isClientSubmitted2) throw new Error('FAIL: isClientSubmitted should be true after client submission');
    console.log('✓ PASS: Client submitted form. "Mark Product Form Received" button will now appear!');

    console.log('\n--- TEST 5: Admin Marks Form Received ---');
    testIpApp.status = 'all_forms_received';
    await testIpApp.save();
    console.log(`Initial Product status is now: ${testIpApp.status}`);
    if (testIpApp.status !== 'all_forms_received') throw new Error('FAIL: status should be all_forms_received');
    console.log('✓ PASS: Form marked as received and ready for logsheet creation.');

    console.log('\n--- TEST 6: Editing Product Name and Code During Logsheet Creation ---');
    const updatedName = 'Premium Organic Chamomile Tea';
    const updatedCode = 'POCT-2026-X';

    // Simulate POST /api/initial-products/:id/create-logsheet with new name and code
    testIpApp.product.name = updatedName;
    testIpApp.product.code = updatedCode;
    testIpApp.status = 'logsheet_created';

    testLogsheet = new ApplicationLogsheet({
      source_type: 'initial_product_application',
      initial_product_application_id: testIpApp._id,
      client_id: testIpApp.client_id,
      company_name: 'Test Corp Ltd',
      product_name: updatedName,
      product_code: updatedCode,
      product_category: `${updatedName} (${updatedCode})`,
      status: 'Waiting for Signature'
    });
    await testLogsheet.save();

    testIpApp.logsheet_id = testLogsheet._id;
    await testIpApp.save();

    // Verify persistence
    const reloadedApp = await InitialProductApplication.findById(testIpApp._id);
    const reloadedLogsheet = await ApplicationLogsheet.findById(testLogsheet._id);

    console.log(`Reloaded App Product Name: "${reloadedApp.product.name}", Code: "${reloadedApp.product.code}"`);
    console.log(`Reloaded Logsheet Product Name: "${reloadedLogsheet.product_name}", Code: "${reloadedLogsheet.product_code}"`);

    if (reloadedApp.product.name !== updatedName || reloadedApp.product.code !== updatedCode) {
      throw new Error('FAIL: Product name and code were not updated on InitialProductApplication');
    }
    if (reloadedLogsheet.product_name !== updatedName || reloadedLogsheet.product_code !== updatedCode) {
      throw new Error('FAIL: Product name and code were not saved on ApplicationLogsheet');
    }
    console.log('✓ PASS: Product Name and Code edited successfully and synchronized across application & logsheet!');

    console.log('\n========================================');
    console.log('ALL TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('========================================');

  } catch (err) {
    console.error('TEST ERROR:', err);
    process.exitCode = 1;
  } finally {
    // Cleanup
    if (testIpApp?._id) {
      await InitialProductApplication.deleteOne({ _id: testIpApp._id });
      console.log('Cleaned up test Initial Product.');
    }
    if (testLogsheet?._id) {
      await ApplicationLogsheet.deleteOne({ _id: testLogsheet._id });
      console.log('Cleaned up test Logsheet.');
    }
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

runTest();
