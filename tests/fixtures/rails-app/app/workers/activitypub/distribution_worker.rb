class ActivityPub::DistributionWorker
  include Sidekiq::Worker

  sidekiq_options queue: 'push'

  def perform(status_id)
    ActivityPub::DeliveryWorker.perform_async(status_id, 'https://example.test/inbox')
  end
end
