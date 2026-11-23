import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTrackerHost, registrableDomain } from '../src/main/privacy.js';

test('registrableDomain reduces hosts to the registrable label', () => {
  assert.equal(registrableDomain('www.example.com'), 'example.com');
  assert.equal(registrableDomain('a.b.example.com'), 'example.com');
  assert.equal(registrableDomain('example.com'), 'example.com');
  assert.equal(registrableDomain('example.com.'), 'example.com');
  assert.equal(registrableDomain('www.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('shop.example.github.io'), 'example.github.io');
});

test('registrableDomain leaves IP addresses and local hosts alone', () => {
  assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(registrableDomain('localhost'), 'localhost');
  assert.equal(registrableDomain('192.168.1.10'), '192.168.1.10');
  assert.equal(registrableDomain(''), '');
});

test('isTrackerHost matches known hosts and their subdomains', () => {
  assert.equal(isTrackerHost('google-analytics.com'), true);
  assert.equal(isTrackerHost('www.google-analytics.com'), true);
  assert.equal(isTrackerHost('region1.google-analytics.com'), true);
  assert.equal(isTrackerHost('connect.facebook.net'), true);
  assert.equal(isTrackerHost('securepubads.g.doubleclick.net'), true);
  assert.equal(isTrackerHost('static.hotjar.com'), true);
});

test('isTrackerHost does not match ordinary sites', () => {
  assert.equal(isTrackerHost('example.com'), false);
  assert.equal(isTrackerHost('cdn.example.com'), false);
  assert.equal(isTrackerHost('notgoogle-analytics.com'), false);
});
